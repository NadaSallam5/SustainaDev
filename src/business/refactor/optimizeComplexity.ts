import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { estimateEnergy } from "../codeCarbon";
import {
  chooseOptimizationStrategy,
  OptimizationStrategy,
} from "./chooseOptimizationStrategy";

import { MethodFacts } from "../types";
import { ICodeAnalyzer, MiniSkeleton } from "../analyzer/analyzerTypes";

/**
 * Interface for the final optimization result
 */
interface OptimizationResult {
  preview: string;
  reason: string;
  previewUri?: string; // NEW: Path to temp file for cleanup
}

/**
 * Step 2 of the Ghost Edit pipeline.
 * Polls the LSP until at least one ERROR-level diagnostic appears on the document.
 * This signals that the language server has parsed the dirty buffer and identified
 * unresolved types (e.g. "HashMap cannot be resolved to a type").
 */
async function pollForLspErrors(uri: vscode.Uri): Promise<void> {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const errors = vscode.languages.getDiagnostics(uri)
      .filter(d => d.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length > 0) {
      console.log(`⚡ LSP ready — ${errors.length} error(s): ${errors.map(e => e.message).join(', ')}`);
      return;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('⚠️ LSP poll timed out — proceeding anyway.');
}

/**
 * Step 3 of the Ghost Edit pipeline.
 * For every ERROR diagnostic on the document, requests resolved Quick Fix code actions
 * from the active language server and applies the first import-related fix found.
 *
 * Cross-language: every LSP universally uses the word "import" in import-fix titles
 * (Java: "Import 'HashMap' (java.util)", TS: "Add import from ...", C#: "using ...").
 * We request itemResolveCount=5 so that lazy placeholder actions are fully populated
 * before we inspect their .edit / .command fields.
 */
// Languages that support the fast single-command import resolution via source.addMissingImports.
// NOTE: Java (JDT.LS) is intentionally excluded — source.addMissingImports is unreliable
// when triggered programmatically. Java falls through to Path B (per-diagnostic quick-fix),
// which is the approach we verified works with itemResolveCount:5.
const NATIVE_IMPORT_LANGUAGES = new Set(['typescript', 'javascript', 'typescriptreact', 'javascriptreact']);

async function applyMissingImports(uri: vscode.Uri, languageId: string): Promise<void> {
  // Small delay to let code action providers fully initialize after diagnostics
  await new Promise(r => setTimeout(r, 300));

  if (NATIVE_IMPORT_LANGUAGES.has(languageId)) {
    // PATH A — Java, TypeScript, JS:
    // Single command handles all missing imports at once. Fast, clean, no iteration.
    console.log(`🧹 [${languageId}] Applying missing imports via source.addMissingImports...`);
    await vscode.commands.executeCommand("editor.action.codeAction", {
      kind: "source.addMissingImports",
      apply: "first"
    });
    await new Promise(r => setTimeout(r, 300));
    return;
  }

  // PATH B — Python (Pylance), C++ (clangd), and others:
  // No single "add all" command exists. Must iterate over each error diagnostic
  // and apply its first import/include quick-fix individually.
  // Python title: "Add 'import numpy'"  → matches 'import'
  // C++ title:    "Add include 'vector'" → matches 'include'
  const IMPORT_TERMS = ['import', 'include'];

  const errorDiags = vscode.languages.getDiagnostics(uri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error);

  console.log(`🧹 [${languageId}] Resolving ${errorDiags.length} error(s) via per-diagnostic Quick Fix...`);
  const seenTitles = new Set<string>();

  for (const diag of errorDiags) {
    try {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        uri,
        diag.range,
        undefined, // no kind filter
        5          // resolve the first 5 actions (populates .edit/.command)
      );
      const fix = actions?.find(a =>
        !seenTitles.has(a.title) &&
        (a.edit || a.command) &&
        IMPORT_TERMS.some(term => a.title.toLowerCase().includes(term))
      );
      if (fix) {
        seenTitles.add(fix.title);
        if (fix.edit) { await vscode.workspace.applyEdit(fix.edit); }
        if (fix.command) { await vscode.commands.executeCommand(fix.command.command, ...(fix.command.arguments || [])); }
        console.log(`  ✅ Applied: "${fix.title}"`);
      } else {
        console.log(`  ⏭️ No import/include fix found for: "${diag.message}"`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Could not resolve quick fix for: ${diag.message}`, e);
    }
  }

  await new Promise(r => setTimeout(r, 300));
}

/**
 * Main entry point for algorithmic optimization
 */
export async function buildOptimizationPatch(
  document: vscode.TextDocument,
  range: { from: number; to: number },
  fileName: string,
  context: {
    targetMethodName: string;
    smellType: string;
    methodFacts: MethodFacts;
  },
  analyzer: ICodeAnalyzer,
): Promise<OptimizationResult> {

  const { targetMethodName, smellType, methodFacts } = context;
  const methodName = targetMethodName;
  const fullCode = document.getText();

  console.log(`🛠️ Patch Builder received type: ${smellType}`);

  // 🧠 STRATEGY DECISION — trust the upstream smell type from chooseRefactor().
  // Only fall back to re-detection when smellType is the generic "GENERAL" case.
  const smellToStrategy: Partial<Record<string, OptimizationStrategy>> = {
    NESTED_LOOPS: OptimizationStrategy.NESTED_LOOPS,
    RECURSION: OptimizationStrategy.ITERATIVE_REWRITE,
    SORTING_IN_LOOP: OptimizationStrategy.SORTING_IN_LOOP,
    SORTING: OptimizationStrategy.SORTING,
    STRING_CONCAT: OptimizationStrategy.STRING_BUILDER,
  };
  const strategy: OptimizationStrategy =
    smellToStrategy[smellType] ?? chooseOptimizationStrategy(methodFacts);

  console.log(`🧠 Chosen optimization strategy: ${strategy}`);
  if (strategy === OptimizationStrategy.KEEP_RECURSION) {
    vscode.window.showInformationMessage(
      "ℹ️ No greener refactor available for this method."
    );

    return {
      preview: fullCode,
      reason: "No energy-efficient refactor detected for this method."
    };
  }



  // 2. Build MiniSkeleton — token-efficient surgical extract
  // Only sends: target method body + class fields + type definitions + imports
  const skeleton = await analyzer.extractSkeleton(document, methodName);

  // Calculate actual token length of what is sent to the AI
  const referencedTypeLines = (skeleton.typeSymbolList ?? [])
    .filter(t => skeleton.targetMethod.includes(t.name))
    .map(t => `${t.name} { ${t.fields} }`);

  const optimizedPayloadLength = skeleton.targetMethod.length +
    skeleton.classFields.length +
    skeleton.imports.length +
    referencedTypeLines.join('\n').length;

  const skeletonTokenEstimate = Math.ceil(optimizedPayloadLength / 4);
  const fullCodeTokenEstimate = Math.ceil(fullCode.length / 4);

  console.log(
    `[MiniSkeleton] Payload sent to LLM: ~${skeletonTokenEstimate} tokens ` +
    `vs full file ~${fullCodeTokenEstimate} tokens ` +
    `(${Math.round((1 - skeletonTokenEstimate / fullCodeTokenEstimate) * 100)}% savings)`
  );



  // 3. AI Generation
  let rawAiResponse = "";

  // Map strategies to smellType strings for callOptimizationAI
  const strategySmellMap: Partial<Record<OptimizationStrategy, string>> = {
    [OptimizationStrategy.ITERATIVE_REWRITE]: "RECURSION",
    [OptimizationStrategy.MEMOIZATION]: smellType,
    [OptimizationStrategy.STRING_BUILDER]: "STRING_BUILDER",
    [OptimizationStrategy.NESTED_LOOPS]: "NESTED_LOOPS",
    [OptimizationStrategy.SORTING_IN_LOOP]: "SORTING_IN_LOOP",
    [OptimizationStrategy.SORTING]: "SORTING",
  };

  const mappedSmell = strategySmellMap[strategy];
  if (mappedSmell !== undefined) {
    rawAiResponse = await callOptimizationAI(skeleton, mappedSmell);
  }
  // ✅ Guard: if AI returned nothing, avoid crash
  if (!rawAiResponse || rawAiResponse.trim().length < 10) {
    throw new Error(`AI returned empty response for strategy: ${strategy}`);
  }
  // 4. Extraction & Validation
  const parseResult = parseAiResponse(rawAiResponse, methodName);

  // 📋 Before / After comparison — printed immediately after AI parse
  console.log("─────────────────────────────────────────────────");
  console.log("📄 BEFORE (Original Method):");
  console.log(skeleton.targetMethod);
  console.log("─────────────────────────────────────────────────");
  console.log("✅ AFTER (AI Refactored Method):");
  console.log(parseResult.newMethod);
  console.log("─────────────────────────────────────────────────");

  // ✅ AST EXACT REPLACEMENT & ACTIVE BUFFER GHOST EDIT
  // Snapshot original text BEFORE any mutations so we can hard-restore later.
  const originalText = fullCode;
  let finalPreview = fullCode;

  if (!skeleton.targetMethodRange) {
    throw new Error("No AST range found for target method. Cannot inject optimized code.");
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.fsPath !== document.uri.fsPath) {
    throw new Error("Target file is not the active editor. Please focus the file and try again.");
  }

  console.log("🚀 Injecting new method directly into the Active Document buffer...");

  // Step 1: Inject AI code into the real active buffer
  const injectEdit = new vscode.WorkspaceEdit();
  injectEdit.replace(document.uri, skeleton.targetMethodRange, parseResult.newMethod);
  await vscode.workspace.applyEdit(injectEdit);

  // Step 2: Wait for the LSP to parse the dirty buffer and report errors
  console.log("⏳ Waiting for native LSP to analyze the dirty buffer...");
  await pollForLspErrors(document.uri);

  // Step 3: Resolve missing imports — method chosen based on language server capabilities
  await applyMissingImports(document.uri, document.languageId);

  // Step 3b: Sweep unused variables left behind by the AI (e.g. 'boolean stockFound = false;')
  console.log("🧹 Sweeping unused variables via fixAll...");
  try {
    await vscode.commands.executeCommand("editor.action.codeAction", {
      kind: "source.fixAll",
      apply: "first"
    });
    await new Promise(r => setTimeout(r, 400));
  } catch (e) {
    console.warn("fixAll not supported for this language, skipping.", e);
  }

  // Step 4: Capture the pristine, LSP-cleaned result
  finalPreview = editor.document.getText();
  console.log("✅ Captured clean preview from native LSP.");

  // Step 5: Hard restore — deterministically revert the buffer to its original state
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );
  const restoreEdit = new vscode.WorkspaceEdit();
  restoreEdit.replace(document.uri, fullRange, originalText);
  await vscode.workspace.applyEdit(restoreEdit);
  
  // FINAL STEP: Revert the document to clear the dirty flag in VS Code.
  // Since we already restored the text to its original state, this is safe and 
  // ensures the tab doesn't show an unsaved 'dot'.
  await vscode.commands.executeCommand("workbench.action.files.revert");
  console.log("👻 Ghost Edit complete. Original file restored and dirty flag cleared.");

  const patch: OptimizationResult = { preview: finalPreview, reason: parseResult.reason };



  // 🛡️ NO-OP CHECK: The "Logic Gate"
  const logicOnlyOriginal = fullCode.replace(/\/\/.*|\/\*[\s\S]*?\*\/|\s/g, "");
  const logicOnlyPatch = patch.preview.replace(
    /\/\/.*|\/\*[\s\S]*?\*\/|\s/g,
    "",
  );

  if (logicOnlyOriginal === logicOnlyPatch) {
    vscode.window.showInformationMessage("✅ Code logic is already optimized.");
    throw new Error("ALREADY_OPTIMIZED");
  }

  // 🔍 SHOW PREVIEW (Original ↔ Optimized)
  if (fileName) {
    const originalUri = vscode.Uri.file(fileName);

    // Derive the file extension from the language so the diff viewer uses correct syntax highlighting.
    const langExtMap: Record<string, string> = {
      java: 'java',
      python: 'py',
      typescript: 'ts',
      javascript: 'js',

    };
    const fileExt = langExtMap[skeleton.language] ?? skeleton.language;
    const previewUri = vscode.Uri.file(
      path.join(
        os.tmpdir(),
        `sustainadev-preview-${Date.now()}.${fileExt}`
      )
    );

    // Write optimized content to temp preview file
    fs.writeFileSync(previewUri.fsPath, patch.preview, "utf8");

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      previewUri,
      "🧠 SustainaDev: Algorithmic Optimization (Original ↔ Optimized)",
      { preview: true }
    );
    patch.previewUri = previewUri.fsPath;
  }


  return patch;
}

/**
 * Handles communication with local Ollama instance.
 * Now accepts a MiniSkeleton instead of the full class block.
 * Tree-sitter note: signature is already language-agnostic via skeleton.language.
 */
async function callOptimizationAI(
  skeleton: MiniSkeleton,
  smellType: string,
) {
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
  });

  const MODEL_NAME = "qwen2.5-coder:7b";

  console.log(`🤖 SustainaDev is calling model: ${MODEL_NAME}`);
  console.log(`🤖 SustainaDev is calling model for: ${smellType} Optimization (${skeleton.language})`);

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    max_tokens: 3096,
    messages: [
      {
        role: "system",
        content:
          `You are a senior ${skeleton.language} engineer focused on Big-O optimization for Green Computing. Always follow the output format exactly. ` +
          `CRITICAL RULE: Never leave unused or orphaned variables in the refactored code (e.g., boolean flags that are no longer checked). You have EXPLICIT PERMISSION TO DELETE code and unused variables that are no longer needed.`,
      },
      {
        role: "user",
        content: getOptimizationPrompt(skeleton, smellType),
      },
    ],
    temperature: 0.1,
  });

  return response.choices?.[0]?.message?.content ?? "";
}

/**
 * Provides specific instructions for each sustainability smell.
 */
function getTaskInstructions(smellType: string): string {
  const TaskLibrary: Record<string, string> = {
    RECURSION:
      "Refactor recursion to a PURE iterative loop (for/while). DO NOT use memoization, HashMaps, or any secondary storage. Achieve O(1) space complexity by using only primitive variables and completely removing self-calls.\n" +
      "If it's a Try/Catch retry:\n" +
      "for(int i=attempt; i<=MAX; i++) { try { doWork(); return; } catch(e) { continue; } }\n" +
      "If it's a state formula:\n" +
      "while(val > 0) { val = update(val); } return val;\n",

    NESTED_LOOPS:
      "Optimize O(N^2) complexity to O(N) by eliminating ALL inner loops. For EACH inner loop, build a lookup HashMap from that loop's collection BEFORE the main loop begins. Use the join condition as the key.\n" +
      "Example:\n" +
      "Map<String, User> userMap = new HashMap<>();\n" +
      "for (User u : users) { userMap.put(u.id, u); }\n" +
      "// Then in the main loop: User u = userMap.get(order.userId);\n",

    STRING_BUILDER:
      "Replace String concatenation inside loops with StringBuilder. Avoid using '+' on Strings inside loops. " +
      "CRITICAL RULE: DO NOT modify the loop structures (e.g. do not convert traditional for-loops to for-each loops). Preserve the exact logic, variables, and output.",


    SORTING_IN_LOOP:
      "Sorting is performed INSIDE a loop. Refactor to avoid repeated sorting. " +
      "If sorting is genuinely needed, sort ONCE outside the loop without changing output. " +
      "If sorting was only used to get max/min, replace sort with a single O(n) scan. " +
      "Keep method signature and preserve exact behavior.",

    SORTING:
      "Sorting detected. Ensure sorting is necessary. If sorting is only used for max/min lookup, replace with a linear scan. " +
      "If order is required, keep sorting but avoid redundant sorts. Preserve exact output.",

    GENERAL:
      "Audit the code for general Green Coding principles: reduce CPU cycles and minimize memory footprints.",
  };

  return TaskLibrary[smellType] || TaskLibrary["GENERAL"];
}

/**
 * Authoritative prompt using MiniSkeleton — language-aware and token-efficient.
 *
 * Sends only: target method + class fields + type definitions + imports.
 * Tree-sitter note: skeleton.language makes this prompt work for any language
 * without any further changes to this function.
 */
function getOptimizationPrompt(
  skeleton: MiniSkeleton,
  smellType: string,
): string {
  const lang = skeleton.language;
  const selectedTask = getTaskInstructions(smellType);
  console.log(smellType + selectedTask);

  // Build context sections only when populated (avoid empty noise in the prompt)
  const fieldsSection = skeleton.classFields
    ? `**Class / Module Fields (for memoization context):**\n\`\`\`${lang}\n${skeleton.classFields}\n\`\`\``
    : "";

  // Only include DTOs referenced in the target method.
  // Use compact field-only format (no constructors, no class header) to minimize tokens.
  const referencedTypeLines = (skeleton.typeSymbolList ?? [])
    .filter(t => skeleton.targetMethod.includes(t.name))
    .map(t => `${t.name} { ${t.fields} }`);

  const typesSection = referencedTypeLines.length > 0
    ? `**Type Shapes (fields only):**\n${referencedTypeLines.join('\n')}`
    : '';

  return `
### ROLE
Expert ${lang.charAt(0).toUpperCase() + lang.slice(1)} Performance Engineer (Sustainability Specialist).

### TASK
1. ${selectedTask}
2. Use the most energy-efficient approach available in standard ${lang} libraries.
3. **Efficiency Goal**: Minimize both CPU cycles and memory allocations.

### BEHAVIORAL INTEGRITY (CRITICAL)
- **Zero Logic Change**: The refactored code MUST produce the exact same output for the same input.
- **Signature Lock**: Do NOT change method names, return types, or parameter lists.
- **No Extra State**: Do NOT add fields, caches, or global/static state unless already present in the class fields below.
- **Edge Cases**: Ensure all edge cases are preserved.
- **Syntax Compatibility**: Use only standard library features available in the language. Do not modernize syntax. Match the coding style of the original code.

### OUTPUT RULES (CRITICAL)
- **Target Method Only**: You must return ONLY the optimized target method in the "Preview" section. Do NOT wrap it in a class or invent a new class name. The method already belongs to class \`${skeleton.className ?? 'the existing class'}\` — return just the method.
- **NEVER Repaper DTOs**: CRITICAL! Do NOT output the existing DTOs, Enums, or Type Definitions in the Preview code. ONLY the single optimized method.
- **Pure Code**: Return pure, raw code without JSON formatting.
- **Clean Up Comments**: adjust any comments inside the method that reference the old, inefficient logic (e.g. "this inner loop...").
- **Permission to Delete**: You have explicit permission to delete absolutely any dead code, unused flags, and variables rendered obsolete by your optimization.

### DATA FOR REFACTORING
**Existing Header/Imports:**
\`\`\`${lang}
${skeleton.imports}
\`\`\`

${fieldsSection}

${typesSection}

**Target Method to Optimize:**
\`\`\`${lang}
${skeleton.targetMethod}
\`\`\`

### OUTPUT FORMAT (MUST FOLLOW EXACTLY)

Preview:
\`\`\`${lang}
(The complete optimized method ONLY. Do NOT wrap it in a class or include existing imports.)
\`\`\`

Reason:
(1-2 sentence technical explanation.)
`;
}

/**
 * Robustly parses AI markdown response
 */
function parseAiResponse(text: string, expectedMethodName?: string): { newMethod: string, reason: string } {
  console.log("🤖 Raw AI Output:", text);

  const previewMatch = text.match(/Preview:[\s\S]*?`{3}(?:\w+)?\n([\s\S]*?)`{3}/i);
  let newMethod = previewMatch ? previewMatch[1].trim() : "";

  if (!newMethod) {
    // fallback if headers are missing
    const codeBlockRegex = /`{3}(?:\w+)?\n([\s\S]*?)`{3}/gi;
    const blocks: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }
    if (blocks.length > 0) {
      newMethod = blocks.reduce((a, b) => (a.length > b.length ? a : b));
    }
  }

  // Sometimes the AI puts the imports inside the Preview block. Strip them out.
  // Handles all major language import styles:
  //   Java:              import java.util.List;
  //   Python:            import os  /  from datetime import date
  //   TypeScript/JS:     import { X } from 'y'
  //   Kotlin/Dart:       import kotlin.collections.*
  newMethod = newMethod
    .replace(/^import\s+[\w\.]+;[\r\n]*/gm, "")           // Java (semicolon)
    .replace(/^import\s+[\w\.\*]+[\r\n]*/gm, "")           // Python bare import
    .replace(/^from\s+[\w\.]+\s+import\s+[^\r\n]*[\r\n]*/gm, "") // Python from...import
    .replace(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"][\r\n]*/gm, "") // TS/JS named
    .replace(/^import\s+[\w*]+\s+from\s+['"][^'"]+['"][\r\n]*/gm, "")   // TS/JS default
    .trim();

  // If the AI disobeyed and printed the DTOs/class wrapper inside the Preview block,
  // we must slice out everything before the actual target method signature,
  // AND trim any trailing class-closing braces via brace-counting.
  if (expectedMethodName) {
    // Language-agnostic method/function signature detection:
    const methodStartRegex = new RegExp(
      `(?:(?:public|private|protected|static|final|async|override|abstract|def|fun|func)\\s+)*` +
      `(?:[\\w<>,[\\]\\s]+\\s+)?${expectedMethodName}\\s*\\(`,
      'm'
    );
    const match = methodStartRegex.exec(newMethod);
    if (match) {
      newMethod = newMethod.substring(match.index).trim();

      // Brace-count to find where the method body ends.
      // This strips any trailing "}" that belongs to a class wrapper.
      let braceDepth = 0;
      let started = false;
      let methodEndIndex = newMethod.length;
      for (let i = 0; i < newMethod.length; i++) {
        const ch = newMethod[i];
        if (ch === '{') { braceDepth++; started = true; }
        else if (ch === '}') {
          braceDepth--;
          if (started && braceDepth === 0) {
            methodEndIndex = i + 1;
            break;
          }
        }
      }
      newMethod = newMethod.substring(0, methodEndIndex).trim();
    }
  }

  const reasonMatch = text.match(/Reason:?\s*([\s\S]*)$/i);
  const reason = reasonMatch
    ? reasonMatch[1].trim()
    : "Optimized algorithmic complexity.";

  if (!newMethod || newMethod.length < 20) {
    throw new Error("AI failed to provide a valid code block.");
  }

  return { newMethod, reason };
}


function bigOToScore(bigO: string): number {
  const s = (bigO || "").replace(/\s+/g, "").toLowerCase();
  if (s.includes("o(1)")) return 1;
  if (s.includes("o(logn)") || s.includes("o(log(n))")) return 2;
  if (s.includes("o(n)") && !s.includes("o(nlogn)") && !s.includes("o(nlog(n))")) return 3;
  if (s.includes("o(nlogn)") || s.includes("o(nlog(n))")) return 4;
  if (s.includes("o(n^2)") || s.includes("o(n2)")) return 5;
  if (s.includes("o(n^3)") || s.includes("o(n3)")) return 6;
  if (s.includes("o(2^n)") || s.includes("o(2n)")) return 7;
  if (s.includes("o(n!)")) return 8;
  return 0;
}

async function logAlgorithmicOptimization(
  workspace: string,
  fileName: string | undefined,
  bigO: { metric: "time" | "space"; before: string; after: string },
  reason: string,
) {
  try {
    const beforeScore = bigOToScore(bigO.before);
    const afterScore = bigOToScore(bigO.after);
    const scoreDelta = Math.max(0, beforeScore - afterScore);
    const energy = await estimateEnergy(scoreDelta * 5);

    const logEntry = {
      timestamp: new Date().toISOString(),
      file: fileName ? path.basename(fileName) : "unknown",
      refactor: "Algorithmic Optimization",
      complexity: {
        metric: bigO.metric,
        before: bigO.before,
        after: bigO.after,
        improvement: `From ${bigO.before} → ${bigO.after}`,
      },
      energy,
      reason,
    };

    const logDir = path.join(workspace, ".sustainadev");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    fs.appendFileSync(
      path.join(logDir, "log.jsonl"),
      JSON.stringify(logEntry) + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("Logging failed:", e);
  }
}


/**
 * Utility to isolate the class context
 */
export type OptimizationReport = {
  metric: "time" | "space";
  before: string;
  after: string;
  improvement: string;
};

export async function logOptimizationFromReport(
  workspace: string,
  fileName: string | undefined,
  report: OptimizationReport,
  reason: string,
) {
  try {
    const beforeScore = bigOToScore(report.before);
    const afterScore = bigOToScore(report.after);
    const scoreDelta = Math.max(0, beforeScore - afterScore);
    const energy = await estimateEnergy(scoreDelta * 5);

    const logEntry = {
      timestamp: new Date().toISOString(),
      file: fileName ? path.basename(fileName) : "unknown",
      refactor: "Algorithmic Optimization",
      complexity: {
        metric: report.metric,
        before: report.before,
        after: report.after,
        improvement: `From ${report.before} → ${report.after}`,
      },
      energy,
      reason,
    };

    const logDir = path.join(workspace, ".sustainadev");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    fs.appendFileSync(
      path.join(logDir, "log.jsonl"),
      JSON.stringify(logEntry) + "\n",
      "utf8",
    );
  } catch (e) {
    console.error("Logging failed:", e);
  }
}

