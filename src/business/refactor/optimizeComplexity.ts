import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { estimateEnergy } from "../codeCarbon";
import {
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

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const { targetMethodName, smellType, methodFacts } = context;
  const methodName = targetMethodName;
  const fullCode = document.getText();

  console.log(`🛠️ Patch Builder received type: ${smellType}`);

  const strategy = context.smellType as OptimizationStrategy;
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

  if (!strategy || strategy === OptimizationStrategy.KEEP_RECURSION) {
    vscode.window.showInformationMessage("ℹ️ No greener refactor available...");
    return { preview: fullCode, reason: "No energy-efficient refactor detected." };
  }

  // ✅ Detect language from filename
  const fileExt = path.extname(fileName).toLowerCase();
  const langMap: Record<string, string> = {
    ".java": "Java",
    ".py": "Python",
    ".js": "JavaScript",
    ".ts": "TypeScript"
  };
  const targetLanguage = langMap[fileExt] || "Java";

  const beforeBigO = estimateBigOFromCode(fullCode, methodName);

  // Extract header — for non-Java languages, take first few lines as header
  let fileHeader = "";
  if (targetLanguage === "Java") {
    fileHeader = fullCode.split(/\bclass\b/)[0].trim();
  } else {
    fileHeader = fullCode.split(/\n/).slice(0, 5).join("\n");
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



  let rawAiResponse = "";

  if (strategy === OptimizationStrategy.ITERATIVE_REWRITE) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "RECURSION", targetLanguage);
  }

  if (strategy === OptimizationStrategy.MEMOIZATION) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, smellType, targetLanguage);
  }

  if (strategy === OptimizationStrategy.STRING_BUILDER) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "STRING_BUILDER", targetLanguage);
  }

  if (strategy === OptimizationStrategy.NESTED_LOOPS) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "NESTED_LOOPS", targetLanguage);
  }

  if (strategy === OptimizationStrategy.SORTING_IN_LOOP) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "SORTING_IN_LOOP", targetLanguage);
  }

  if (strategy === OptimizationStrategy.SORTING) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "SORTING", targetLanguage);
  }

  if (strategy === OptimizationStrategy.GENERAL || !rawAiResponse) {
    rawAiResponse = await callOptimizationAI(fullCode, range, fileHeader, "GENERAL", targetLanguage);
  }

  if (!rawAiResponse || rawAiResponse.trim().length < 10) {
    throw new Error(`AI returned empty response for strategy: ${strategy}`);
  }

  const patch = parseAiResponse(rawAiResponse, targetLanguage);

  if (strategy === OptimizationStrategy.DUPLICATE_COMPUTATION) {
    if (fullCode.includes("private int expensive(") && !patch.preview.includes("private int expensive(")) {
      throw new Error("AI changed method signature for expensive().");
    }
  }

  if (strategy === OptimizationStrategy.SORTING_IN_LOOP) {
    const stillHasSortInsideLoop =
      patch.preview.includes("for (") &&
      (patch.preview.includes("Collections.sort") || patch.preview.includes("Arrays.sort")) &&
      patch.preview.indexOf("sort") > patch.preview.indexOf("for (");

    if (stillHasSortInsideLoop) {
      throw new Error("AI did not move sorting out of the loop for SORTING_IN_LOOP.");
    }
  }

  const logicOnlyOriginal = fullCode.replace(/\/\/.*|\/\*[\s\S]*?\*\/|#.*|\s/g, "");
  const logicOnlyPatch = patch.preview.replace(/\/\/.*|\/\*[\s\S]*?\*\/|#.*|\s/g, "");
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

  if (fileName) {
    const originalUri = vscode.Uri.file(fileName);
    const ext = path.extname(fileName) || ".java";
    const previewUri = vscode.Uri.file(
      path.join(os.tmpdir(), `sustainadev-preview-${Date.now()}${ext}`)
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
      `🧠 SustainaDev: Algorithmic Optimization (Original ↔ Optimized)`,
      { preview: true }
    );
    patch.previewUri = previewUri.fsPath;
  }

  return patch;
}

async function callOptimizationAI(
  fullCode: string,
  range: { from: number; to: number },
  existingImports: string,

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
  targetLanguage: string = "Java"
) {
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
  });

  const { classBlock } = extractClassBlock(fullCode, Math.max(0, range.from - 1));
  const MODEL_NAME = "qwen2.5-coder:7b";

  console.log(`🤖 SustainaDev is calling model: ${MODEL_NAME}`);
  console.log(`🤖 SustainaDev is calling model for: ${smellType} Optimization in ${targetLanguage}`);
  const MODEL_NAME = "qwen2.5-coder:7b";

  console.log(`🤖 SustainaDev is calling model: ${MODEL_NAME}`);
  console.log(`🤖 SustainaDev is calling model for: ${smellType} Optimization (${skeleton.language})`);

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    max_tokens: 3096,
    messages: [
      {
        role: "system",
        content: `You are a senior ${targetLanguage} engineer focused on Big-O optimization for Green Computing. Always follow the output format exactly. Output ONLY valid ${targetLanguage} code. Never output Java unless the file language IS Java.`,
      },
      {
        role: "user",
        content: getOptimizationPrompt(classBlock, existingImports, smellType, targetLanguage),
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

function getOptimizationPrompt(
  skeleton: MiniSkeleton,
  smellType: string,
  targetLanguage: string = "Java"
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
Expert ${targetLanguage} Performance Engineer (Sustainability Specialist).

### TASK
1. ${selectedTask}
2. Use the most energy-efficient approach available in standard ${targetLanguage} libraries.
Expert ${lang.charAt(0).toUpperCase() + lang.slice(1)} Performance Engineer (Sustainability Specialist).

### TASK
1. ${selectedTask}
2. Use the most energy-efficient approach available in standard ${lang} libraries.
3. **Efficiency Goal**: Minimize both CPU cycles and memory allocations.

### BEHAVIORAL INTEGRITY (CRITICAL)
- **Zero Logic Change**: The refactored code MUST produce the exact same output for the same input.
- **Signature Lock**: Do NOT change method names, return types, or parameter lists.
- **No Extra State**: Do NOT add fields, caches, or global/static state.
- **Language Lock**: Output ONLY valid ${targetLanguage} code. Never switch languages.
- **No Extra State**: Do NOT add fields, caches, or global/static state unless already present in the class fields below.
- **Edge Cases**: Ensure all edge cases are preserved.
- **Syntax Compatibility**: Use only standard library features available in the language. Do not modernize syntax. Match the coding style of the original code.

### IMPORT RULES (CRITICAL)
- **Maintain Current Header**: You MUST include the existing imports/header provided below at the very top.
- **Auto-Include New Imports**: If your optimization uses new classes/modules, add their imports.
- **Full File Output**: Your "Preview" section MUST contain the complete file.
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

**Target Code Block:**
\`\`\`${targetLanguage.toLowerCase()}
${code}
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

function parseAiResponse(text: string, targetLanguage: string = "Java"): OptimizationResult {
  console.log("🤖 Raw AI Output:", text);

  const codeBlockRegex = /```[\w]*\n?([\s\S]*?)```/gi;
  const blocks: string[] = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.length > 20) {
      blocks.push(content);
    }
  }

  let preview = "";

  if (blocks.length > 0) {
    preview = blocks.reduce((a, b) => (a.length > b.length ? a : b));
  } else {
    const previewMatch = text.match(/Preview:?\s*([\s\S]*?)(?:Reason:|$)/i);
    if (previewMatch) {
      preview = previewMatch[1].trim();
    } else {
      preview = text.trim();
    }
  }

  if (
    targetLanguage === "Java" &&
    preview.startsWith("public") &&
    !preview.match(
      /^public\s+(class|final|abstract|interface|@interface|enum)/,
    )
  ) {
    preview = preview.replace(/^public\s+/, "").trim();
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
    ? reasonMatch[1].replace(/```[\s\S]*```/g, "").trim()
    : "Optimized algorithmic complexity.";

  if (!newMethod || newMethod.length < 20) {
    throw new Error("AI failed to provide a valid code block.");
  }

  return { newMethod, reason };
}

function extractMethodBody(fullCode: string, methodName: string): string {
  const sig = new RegExp(`\\b${methodName}\\s*\\(`);
  const lines = fullCode.split(/\r?\n/);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (sig.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return fullCode;

  let brace = 0;
  let started = false;
  const out: string[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === "{") { brace++; started = true; }
      else if (ch === "}") { brace--; }
    }
    if (started && brace === 0) break;
  }

  return out.join("\n");
}

function estimateSpaceBigOFromCode(fullCode: string, methodName: string): string {
  const method = extractMethodBody(fullCode, methodName);
  const cleaned = method.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const bodyOnly = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{") + 1) : cleaned;
  const selfCalls = (bodyOnly.match(new RegExp(`\\b${methodName}\\s*\\(`, "g")) || []).length;
  if (selfCalls >= 1) return "O(n)";
  return "O(1)";
}

function estimateBigOFromCode(fullCode: string, methodName: string): string {
  const method = extractMethodBody(fullCode, methodName);
  const cleaned = method.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  const bodyOnly = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{") + 1) : cleaned;
  const selfCalls = (bodyOnly.match(new RegExp(`\\b${methodName}\\s*\\(`, "g")) || []).length;

  let brace = 0;
  const loopStack: number[] = [];
  let maxLoopDepth = 0;

  const tokens = method.split(/\r?\n/);
  for (const line of tokens) {
    const l = line.replace(/\/\/.*$/, "");
    if (/\b(for|while)\s*[\(\:]/.test(l)) {
      loopStack.push(brace);
      if (loopStack.length > maxLoopDepth) maxLoopDepth = loopStack.length;
    }
    for (const ch of l) {
      if (ch === "{") brace++;
      else if (ch === "}") {
        brace--;
        while (loopStack.length && brace < loopStack[loopStack.length - 1]) loopStack.pop();
      }
    }
  }

  const hasStringVar = /\bString\s+\w+\s*=/.test(method);
  const stringConcatInLoop = /\b(for|while)\s*\([\s\S]*?\)\s*\{[\s\S]*?(=\s*\w+\s*\+|\+=)\s*[\s\S]*?\}/.test(method);
  if (maxLoopDepth === 1 && hasStringVar && stringConcatInLoop) return "O(n^2)";
  if (maxLoopDepth >= 3) return "O(n^3)";
  if (maxLoopDepth === 2) return "O(n^2)";
  if (maxLoopDepth === 1) return "O(n)";
  if (selfCalls >= 2) return "O(2^n)";
  if (selfCalls === 1) return "O(n)";
  return "O(1)";
}

function bigOToScore(bigO: string): number {
  const s = (bigO || "").replace(/\s+/g, "").toLowerCase();
  if (s.includes("o(1)")) return 1;
  if (s.includes("o(logn)") || s.includes("o(log(n))")) return 2;
  if (
    s.includes("o(n)") &&
    !s.includes("o(nlogn)") &&
    !s.includes("o(nlog(n))")
  )
    return 3;
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

// ─── Single merged logOptimizationFromReport ────────────────────────────────
/**
 * Logs an optimization result to .sustainadev/log.jsonl
 * Supports both full sustainability metrics and simple energy estimation.
 */
export async function logOptimizationFromReport(
  workspace: string,
  fileName: string | undefined,
  report: OptimizationReport,
  reason: string,
  sustainability?: {
    energyKwh: number;
    carbonGrams: number;
    beforeEnergyKwh: number;
    beforeCarbonGrams: number;
  },
  refactorType?: string,
) {
  try {
    const refactorLabelMap: Record<string, string> = {
      ITERATIVE_REWRITE: "Iterative Rewrite (Recursion → Loop)",
      MEMOIZATION: "Memoization (Overlapping Subproblems)",
      STRING_BUILDER: "String Concatenation → StringBuilder",
      STRING_CONCAT: "String Concatenation → StringBuilder",
      DUPLICATE_COMPUTATION: "Duplicate Computation Elimination",
      NESTED_LOOPS: "Nested Loops Optimization",
      SORTING_IN_LOOP: "Sorting Moved Out of Loop",
      SORTING: "Redundant Sorting Removal",
      GENERAL: "General Green Coding Optimization",
    };

    const refactorLabel =
      refactorType && refactorLabelMap[refactorType]
        ? refactorLabelMap[refactorType]
        : refactorType ?? "Algorithmic Optimization";

    // Compute energy from Big-O scores when no sustainability object is provided
    let energy: any = undefined;
    if (!sustainability) {
      const beforeScore = bigOToScore(report.before);
      const afterScore = bigOToScore(report.after);
      const scoreDelta = Math.max(0, beforeScore - afterScore);
      energy = await estimateEnergy(scoreDelta * 5);
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      file: fileName ? path.basename(fileName) : "unknown",
      refactor: refactorLabel,
      complexity: {
        metric: report.metric,
        before: report.before,
        after: report.after,
        improvement: `From ${report.before} → ${report.after}`,
      },
      sustainability: sustainability
        ? {
            before: {
              energyKwh: sustainability.beforeEnergyKwh,
              carbonGrams: sustainability.beforeCarbonGrams,
            },
            after: {
              energyKwh: sustainability.energyKwh,
              carbonGrams: sustainability.carbonGrams,
            },
            saved: {
              energyKwh: sustainability.beforeEnergyKwh - sustainability.energyKwh,
              carbonGrams: sustainability.beforeCarbonGrams - sustainability.carbonGrams,
            },
          }
        : null,
      energy: energy ?? null,
      reason,
    };

    const logDir = path.join(workspace, ".sustainadev");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, "log.jsonl"),
      JSON.stringify(logEntry) + "\n",
      "utf8"
    );
  } catch (e) {
    console.error("Logging failed:", e);
  }
}

export function extractClassBlock(fullCode: string, startLine: number) {
  const lines = fullCode.split(/\r?\n/);
  let classStart = -1;
  for (let i = startLine; i >= 0; i--) {
    if (/\bclass\s+\w+/.test(lines[i])) { classStart = i; break; }
  }
  classStart = classStart === -1 ? 0 : classStart;

  let braceCount = 0, foundBrace = false, classEnd = lines.length - 1;
  for (let i = classStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { braceCount++; foundBrace = true; }
      if (ch === "}") braceCount--;
    }
    if (foundBrace && braceCount === 0) { classEnd = i; break; }
  }
  return { classBlock: lines.slice(classStart, classEnd + 1).join("\n") };
}
