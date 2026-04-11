import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { estimateEnergy } from "../codeCarbon";
import { OptimizationStrategy, chooseOptimizationStrategy } from "./chooseOptimizationStrategy";
import { MethodFacts } from "../types";
import { ICodeAnalyzer, MiniSkeleton } from "../analyzer/analyzerTypes";

/**
 * Interface for the final optimization result
 */
interface OptimizationResult {
  preview: string;
  reason: string;
  previewUri?: string;
}

async function pollForLspErrors(uri: vscode.Uri): Promise<void> {
  // If the AI generated perfect code, there will never be errors, so we shouldn't wait 4.5s!
  // Wait exactly 800ms to give the LSP a chance to wake up and parse the dirty buffer.
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    const errors = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length > 0) {
      console.log(
        `⚡ LSP ready — ${errors.length} error(s): ${errors.map((e) => e.message).join(", ")}`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log("✅ LSP poll finished — no errors detected.");
}

/**
 * Step 3 of the Ghost Edit pipeline.
 * Applies missing imports via the language server.
 */
const NATIVE_IMPORT_LANGUAGES = new Set([
  "typescript",
  "javascript",

]);

async function applyMissingImports(
  uri: vscode.Uri,
  languageId: string
): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));

  if (NATIVE_IMPORT_LANGUAGES.has(languageId)) {
    console.log(
      `🧹 [${languageId}] Applying missing imports via source.addMissingImports...`
    );
    await vscode.commands.executeCommand("editor.action.codeAction", {
      kind: "source.addMissingImports",
      apply: "first",
    });
    await new Promise((r) => setTimeout(r, 100));
    return;
  }

  const IMPORT_TERMS = ["import", "include"];
  const errorDiags = vscode.languages
    .getDiagnostics(uri)
    .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

  console.log(
    `🧹 [${languageId}] Resolving ${errorDiags.length} error(s) via per-diagnostic Quick Fix...`
  );
  const seenTitles = new Set<string>();

  for (const diag of errorDiags) {
    try {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        uri,
        diag.range,
        undefined,
        5
      );
      const fix = actions?.find(
        (a) =>
          !seenTitles.has(a.title) &&
          (a.edit || a.command) &&
          IMPORT_TERMS.some((term) => a.title.toLowerCase().includes(term))
      );
      if (fix) {
        seenTitles.add(fix.title);
        if (fix.edit) {
          await vscode.workspace.applyEdit(fix.edit);
        }
        if (fix.command) {
          await vscode.commands.executeCommand(
            fix.command.command,
            ...(fix.command.arguments || [])
          );
        }
        console.log(`  ✅ Applied: "${fix.title}"`);
      } else {
        console.log(`  ⏭️ No import/include fix found for: "${diag.message}"`);
      }
    } catch (e) {
      console.warn(`  ⚠️ Could not resolve quick fix for: ${diag.message}`, e);
    }
  }

  await new Promise((r) => setTimeout(r, 50));
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
  analyzer: ICodeAnalyzer
): Promise<OptimizationResult> {
  const workspace =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const { targetMethodName, smellType, methodFacts } = context;
  const methodName = targetMethodName;
  const fullCode = document.getText();

  console.log(`🛠️ Patch Builder received type: ${smellType}`);

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

  // 2. Build MiniSkeleton
  const skeleton = await analyzer.extractSkeleton(document, methodName);

  // DEBUG: Dumps the exactly what context is being sent to the AI
  console.log("🧩 [Skeleton Debug] Full Payload Context:");
  console.log(JSON.stringify({
    language: skeleton.language,
    imports: skeleton.imports,
    classFields: skeleton.classFields,
    typeDefinitions: skeleton.typeDefinitions,
    targetMethod: skeleton.targetMethod,
    className: skeleton.className,
    typeSymbolsCount: skeleton.typeSymbolList?.length ?? 0
  }, null, 2));

  const referencedTypeLines = (skeleton.typeSymbolList ?? [])
    .filter((t) => skeleton.targetMethod.includes(t.name))
    .map((t) => `${t.name} { ${t.fields} }`);

  const optimizedPayloadLength =
    skeleton.targetMethod.length +
    skeleton.classFields.length +
    skeleton.imports.length +
    referencedTypeLines.join("\n").length;

  const skeletonTokenEstimate = Math.ceil(optimizedPayloadLength / 4);
  const fullCodeTokenEstimate = Math.ceil(fullCode.length / 4);

  console.log(
    `[MiniSkeleton] Payload sent to LLM: ~${skeletonTokenEstimate} tokens ` +
    `vs full file ~${fullCodeTokenEstimate} tokens ` +
    `(${Math.round((1 - skeletonTokenEstimate / fullCodeTokenEstimate) * 100)}% savings)`
  );

  const strategySmellMap: Partial<Record<OptimizationStrategy, string>> = {
    [OptimizationStrategy.ITERATIVE_REWRITE]: "RECURSION",
    [OptimizationStrategy.MEMOIZATION]: smellType,
    [OptimizationStrategy.STRING_BUILDER]: "STRING_BUILDER",
    [OptimizationStrategy.NESTED_LOOPS]: "NESTED_LOOPS",
    [OptimizationStrategy.SORTING_IN_LOOP]: "SORTING_IN_LOOP",
    [OptimizationStrategy.SORTING]: "SORTING",
  };

  const mappedSmell = strategySmellMap[strategy] ?? "GENERAL";
  const rawAiResponse = await callOptimizationAI(skeleton, mappedSmell);

  if (!rawAiResponse || rawAiResponse.trim().length < 10) {
    throw new Error(`AI returned empty response for strategy: ${strategy}`);
  }

  // 4. Extraction & Validation
  const parseResult = parseAiResponse(rawAiResponse, methodName);

  console.log("─────────────────────────────────────────────────");
  console.log("📄 BEFORE (Original Method):");
  console.log(skeleton.targetMethod);
  console.log("─────────────────────────────────────────────────");
  console.log("✅ AFTER (AI Refactored Method):");
  console.log(parseResult.newMethod);
  console.log("─────────────────────────────────────────────────");

  const originalText = fullCode;
  let finalPreview = fullCode;

  if (!skeleton.targetMethodRange) {
    throw new Error(
      "No AST range found for target method. Cannot inject optimized code."
    );
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.fsPath !== document.uri.fsPath) {
    throw new Error(
      "Target file is not the active editor. Please focus the file and try again."
    );
  }

  console.log("🚀 Injecting new method directly into the Active Document buffer...");

  // Step 1: Inject AI code into the real active buffer
  const injectEdit = new vscode.WorkspaceEdit();
  injectEdit.replace(document.uri, skeleton.targetMethodRange, parseResult.newMethod);
  await vscode.workspace.applyEdit(injectEdit);

  // FIX 3: Stabilization delay AFTER inject
  await new Promise((r) => setTimeout(r, 50));

  // Step 2: Wait for LSP
  console.log("⏳ Waiting for native LSP to analyze the dirty buffer...");
  await pollForLspErrors(document.uri);

  // Step 3: Resolve missing imports
  await applyMissingImports(document.uri, document.languageId);

  // Step 3b: Sweep unused variables
  console.log("🧹 Sweeping unused variables via fixAll...");
  try {
    await vscode.commands.executeCommand("editor.action.codeAction", {
      kind: "source.fixAll",
      apply: "first",
    });
    await new Promise((r) => setTimeout(r, 100));
  } catch (e) {
    console.warn("fixAll not supported for this language, skipping.", e);
  }

  // Step 4: Capture clean result
  finalPreview = editor.document.getText();
  console.log("✅ Captured clean preview from native LSP.");

  // Step 5: Hard restore
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );
  const restoreEdit = new vscode.WorkspaceEdit();
  restoreEdit.replace(document.uri, fullRange, originalText);
  await vscode.workspace.applyEdit(restoreEdit);

  console.log("👻 Ghost Edit complete. Original file restored.");

  const patch: OptimizationResult = { preview: finalPreview, reason: parseResult.reason };

  // 🛡️ NO-OP CHECK
  const logicOnlyOriginal = fullCode.replace(/\/\/.*|\/\*[\s\S]*?\*\/|\s/g, "");
  const logicOnlyPatch = patch.preview.replace(/\/\/.*|\/\*[\s\S]*?\*\/|\s/g, "");

  if (logicOnlyOriginal === logicOnlyPatch) {
    vscode.window.showInformationMessage("✅ Code logic is already optimized.");
    throw new Error("ALREADY_OPTIMIZED");
  }

  if (fileName) {
    const originalUri = vscode.Uri.file(fileName);

    const langExtMap: Record<string, string> = {
      java: "java",
      python: "py",
      typescript: "ts",
      javascript: "js",
    };
    const fileExt = langExtMap[skeleton.language] ?? skeleton.language;

    // Create temp file for ORIGINAL
    const originalTmpUri = vscode.Uri.file(
      path.join(os.tmpdir(), `sustainadev-orig-${Date.now()}.${fileExt}`)
    );
    // Create temp file for PREVIEW (optimized)
    const previewTmpUri = vscode.Uri.file(
      path.join(os.tmpdir(), `sustainadev-preview-${Date.now()}.${fileExt}`)
    );

    // Write both to disk to guarantee stable diff inputs
    fs.writeFileSync(originalTmpUri.fsPath, originalText, "utf8");
    fs.writeFileSync(previewTmpUri.fsPath, patch.preview, "utf8");

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalTmpUri,
      previewTmpUri,
      `🧠 SustainaDev: Algorithmic Optimization (Original ↔ Optimized)`,
      { preview: true }
    );
    patch.previewUri = previewTmpUri.fsPath;
  }

  return patch;
}

/**
 * Handles communication with local Ollama instance.
 */
async function callOptimizationAI(
  skeleton: MiniSkeleton,
  smellType: string
) {
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
  });

  const MODEL_NAME = "qwen2.5-coder:7b";
  console.log(`🤖 SustainaDev is calling model: ${MODEL_NAME}`);
  console.log(
    `🤖 SustainaDev is calling model for: ${smellType} Optimization (${skeleton.language})`
  );

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

function getOptimizationPrompt(skeleton: MiniSkeleton, smellType: string): string {
  const lang = skeleton.language;
  const selectedTask = getTaskInstructions(smellType);
  console.log(smellType + selectedTask);

  const fieldsSection = skeleton.classFields
    ? `**Class / Module Fields (for memoization context):**\n\`\`\`${lang}\n${skeleton.classFields}\n\`\`\``
    : "";

  const referencedTypeLines = (skeleton.typeSymbolList ?? [])
    .filter((t) => skeleton.targetMethod.includes(t.name))
    .map((t) => `${t.name} { ${t.fields} }`);

  const typesSection =
    referencedTypeLines.length > 0
      ? `**Type Shapes (fields only):**\n${referencedTypeLines.join("\n")}`
      : "";

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
- **Target Method Only**: You must return ONLY the optimized target method in the "Preview" section. Do NOT wrap it in a class or invent a new class name. The method already belongs to class \`${skeleton.className ?? "the existing class"}\` — return just the method.
- **NEVER Repaper DTOs**: CRITICAL! Do NOT output the existing DTOs, Enums, or Type Definitions in the Preview code. ONLY the single optimized method.
- **Pure Code**: Return pure, raw code without JSON formatting.
- **Clean Up Comments**: adjust any comments inside the method that reference the old, inefficient logic.
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
 * Robustly parses AI markdown response.
 */
function parseAiResponse(
  text: string,
  expectedMethodName?: string
): { newMethod: string; reason: string } {
  console.log("🤖 Raw AI Output:", text);

  const previewMatch = text.match(
    /Preview:[\s\S]*?`{3}(?:\w+)?\n([\s\S]*?)`{3}/i
  );
  let newMethod = previewMatch ? previewMatch[1].trim() : "";

  if (!newMethod) {
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

  // Strip stray imports the AI may have included in the Preview block
  newMethod = newMethod
    .replace(/^import\s+[\w\.]+;[\r\n]*/gm, "")
    .replace(/^import\s+[\w\.\*]+[\r\n]*/gm, "")
    .replace(/^from\s+[\w\.]+\s+import\s+[^\r\n]*[\r\n]*/gm, "")
    .replace(/^import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"][\r\n]*/gm, "")
    .replace(/^import\s+[\w*]+\s+from\s+['"][^'"]+['"][\r\n]*/gm, "")
    .trim();

  if (expectedMethodName) {
    const methodStartRegex = new RegExp(
      `(?:(?:public|private|protected|static|final|async|override|abstract|def|fun|func)\\s+)*` +
      `(?:[\\w<>,[\\]\\s]+\\s+)?${expectedMethodName}\\s*\\(`,
      "m"
    );
    const match = methodStartRegex.exec(newMethod);
    if (match) {
      newMethod = newMethod.substring(match.index).trim();

      let braceDepth = 0;
      let started = false;
      let methodEndIndex = newMethod.length;
      for (let i = 0; i < newMethod.length; i++) {
        const ch = newMethod[i];
        if (ch === "{") {
          braceDepth++;
          started = true;
        } else if (ch === "}") {
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

export type OptimizationReport = {
  metric: "time" | "space";
  before: string;
  after: string;
  improvement: string;
};

/**
 * Logs an optimization result to .sustainadev/log.jsonl
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
  refactorType?: string
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