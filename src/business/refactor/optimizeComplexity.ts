import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OptimizationReport } from "../complexity/types";
import { estimateEnergy } from "../codeCarbon";
import { OptimizationStrategy } from "./ruleEngine";
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

async function pollForLspErrors(uri: vscode.Uri, initialErrorCount: number): Promise<void> {
  // If the AI generated perfect code, there will never be new errors, so we wait max 800ms.
  // Wait exactly 800ms to give the LSP a chance to wake up and parse the dirty buffer.
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    const errors = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
      
    // Wait until LSP surfaces NEW errors (like missing imports)
    if (errors.length !== initialErrorCount) {
      console.log(
        `⚡ LSP ready — Error count changed from ${initialErrorCount} to ${errors.length}`
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log("✅ LSP poll finished — max wait reached or no new errors.");
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

  // ── TIMEOUT FIX: never hang forever waiting for LSP import resolution ──────
  const importWork = async () => {
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
  };

  // Give LSP 5 seconds max — then move on regardless
  await Promise.race([
    importWork(),
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
  console.log("✅ Import resolution done or timed out.");
  // ── END TIMEOUT FIX ────────────────────────────────────────────────────────

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

  // The strategy IS the smell type string — enum values are identical to their keys.
  // ruleEngine.detectByRules() guarantees only valid strategies reach this point.
  const strategy = smellType as OptimizationStrategy;
  if (!Object.values(OptimizationStrategy).includes(strategy)) {
    vscode.window.showInformationMessage("ℹ️ No greener refactor available for this method.");
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

  const rawAiResponse = await callOptimizationAI(skeleton, strategy);

  if (!rawAiResponse || rawAiResponse.trim().length < 10) {
    throw new Error(`AI returned empty response for strategy: ${strategy}`);
  }

  // ── FIX 3: Parse with language passed in ──────────────────────────────────
  const parseResult = parseAiResponse(rawAiResponse, methodName, skeleton.language);

  // ── FIX 3: Safety guard — method name must appear in output ───────────────
  if (!parseResult.newMethod.includes(methodName)) {
    vscode.window.showErrorMessage(
      `⚠️ SustainaDev: AI returned invalid code for '${methodName}'. Optimization cancelled.`
    );
    return { preview: fullCode, reason: "AI failed to return valid optimized method." };
  }

  // ── FIX 3: Extra Python guard — must start with def ───────────────────────
  if (skeleton.language === "python" && !parseResult.newMethod.trimStart().startsWith("def ")) {
    vscode.window.showErrorMessage(
      `⚠️ SustainaDev: Python optimization returned incomplete code. Optimization cancelled.`
    );
    return { preview: fullCode, reason: "AI returned Python body without def signature." };
  }

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
  const initialErrors = vscode.languages
    .getDiagnostics(document.uri)
    .filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;

  const injectEdit = new vscode.WorkspaceEdit();
  injectEdit.replace(document.uri, skeleton.targetMethodRange, parseResult.newMethod);
  await vscode.workspace.applyEdit(injectEdit);

  // FIX 3: Stabilization delay AFTER inject
  await new Promise((r) => setTimeout(r, 50));

  // Step 2: Wait for LSP
  console.log("⏳ Waiting for native LSP to analyze the dirty buffer...");
  await pollForLspErrors(document.uri, initialErrors);

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
    ITERATIVE_REWRITE:
      "Refactor recursion to a PURE iterative loop (for/while). DO NOT use memoization, HashMaps, or any secondary storage. Achieve O(1) space complexity by using only primitive variables and completely removing self-calls.\n" +
      "If it's a Try/Catch retry:\n" +
      "for(int i=attempt; i<=MAX; i++) { try { doWork(); return; } catch(e) { continue; } }\n" +
      "If it's a state formula:\n" +
      "while(val > 0) { val = update(val); } return val;\n",

 NESTED_LOOPS:
  "Optimize O(N^2) or O(N^3) complexity to O(N) by eliminating ALL inner loops.\n" +
  "CRITICAL: You MUST convert EVERY inner loop to a HashMap lookup. If there are 2 inner loops, build 2 HashMaps. If there are 3 inner loops, build 3 HashMaps.\n" +
  "STEP 1: Identify ALL inner loops in the method.\n" +
  "STEP 2: For EACH inner loop, build a separate HashMap BEFORE the outer loop.\n" +
  "STEP 3: Replace EACH inner loop with a single HashMap.get() call.\n" +
  "STEP 4: The final code must have ZERO nested loops — only sequential loops.\n" +
  "// EXAMPLE with 2 inner loops:\n" +
  "// BEFORE:\n" +
  "// for (o of orders) {\n" +
  "//   for (u of users) { if (u.id === o.userId) ... }  ← inner loop 1\n" +
  "//   for (p of products) { if (p.id === o.productId) ... }  ← inner loop 2\n" +
  "// }\n" +
  "// AFTER:\n" +
  "// Map<String, User> userMap = new HashMap<>();\n" +
  "// for (u of users) { userMap.put(u.id, u); }  ← sequential loop 1\n" +
  "// Map<String, Product> productMap = new HashMap<>();\n" +
  "// for (p of products) { productMap.put(p.id, p); }  ← sequential loop 2\n" +
  "// for (o of orders) {\n" +
  "//   User u = userMap.get(o.userId);  ← O(1) lookup\n" +
  "//   Product p = productMap.get(o.productId);  ← O(1) lookup\n" +
  "// }  ← ONE outer loop only\n" +
  "NEVER use Math.pow() or ** operator. NEVER remove all loops completely.\n",
    STRING_BUILDER:
      "Replace all String concatenation inside loops with a StringBuilder (Java), an array + join (JS/TS/Python), or equivalent. " +
      "Avoid using '+' or '+=' on Strings inside any loop. " +
      "CRITICAL RULE: DO NOT modify the loop structure. Preserve the exact logic, variables, and output.",

    SORTING_IN_LOOP:
      "Sorting is performed INSIDE a loop. Refactor to avoid repeated sorting. " +
      "If sorting is genuinely needed, sort ONCE outside the loop without changing output. " +
      "If sorting was only used to get max/min, replace sort with a single O(n) scan. " +
      "Keep method signature and preserve exact behavior.",

    SORTING:
      "Sorting detected. Ensure sorting is necessary. If sorting is only used for max/min lookup, replace with a linear scan. " +
      "If order is required, keep sorting but avoid redundant sorts. Preserve exact output.",
  };

  const instruction = TaskLibrary[smellType];
  if (!instruction) {
    throw new Error(`[SustainaDev] No task instruction found for smell: '${smellType}'. Only the 5 supported strategies are allowed.`);
  }
  return instruction;
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

  // ── FIX 1: Python-specific output rule injected into the prompt ───────────
  const pythonDefName = lang === "python"
    ? skeleton.targetMethod.match(/def\s+(\w+)/)?.[1] ?? "the_method"
    : null;

  const targetMethodOnlyRule = lang === "python"
    ? `- **Target Method Only**: Return ONLY the optimized method. For Python: ALWAYS start with the complete \`def ${pythonDefName}(...):\` signature on the first line. NEVER return just the body without the def line.`
    : `- **Target Method Only**: You must return ONLY the optimized target method in the "Preview" section. Do NOT wrap it in a class or invent a new class name. The method already belongs to class \`${skeleton.className ?? "the existing class"}\` — return just the method.`;

  const neverPartialRule = lang === "python"
    ? `- **NEVER return partial code**: Always include the COMPLETE function — def signature, all loops, all branches, and the return statement. Incomplete snippets will be rejected.`
    : `- **NEVER Repaper DTOs**: CRITICAL! Do NOT output the existing DTOs, Enums, or Type Definitions in the Preview code. ONLY the single optimized method.`;

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
- ${targetMethodOnlyRule}
- ${neverPartialRule}
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
 * FIX 2: Added language parameter for Python-specific validation.
 */
function parseAiResponse(
  text: string,
  expectedMethodName?: string,
  language?: string            // ── FIX 2: new parameter ──
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

  // ── FIX 2: Python-specific validation ────────────────────────────────────
  if (expectedMethodName && language === "python") {
    if (!newMethod.trimStart().startsWith("def ")) {
      throw new Error(
        `AI returned Python method body without 'def ${expectedMethodName}' signature. Rejecting.`
      );
    }
    if (!newMethod.includes(`def ${expectedMethodName}`)) {
      throw new Error(
        `AI returned wrong method name. Expected 'def ${expectedMethodName}'.`
      );
    }
    const nonEmptyLines = newMethod.split("\n").filter(l => l.trim().length > 0);
    if (nonEmptyLines.length < 3) {
      throw new Error(
        `AI returned incomplete Python method (only ${nonEmptyLines.length} non-empty lines).`
      );
    }
  }

  if (expectedMethodName) {
    const methodStartRegex = new RegExp(
      `(?:(?:public|private|protected|static|final|async|override|abstract|def|fun|func)\\s+)*` +
      `(?:[\\w<>,[\\]\\s]+\\s+)?${expectedMethodName}\\s*\\(`,
      "m"
    );
    const match = methodStartRegex.exec(newMethod);
    if (match) {
      newMethod = newMethod.substring(match.index).trim();

      // For Python, skip brace-counting entirely — indentation ends the method
      if (language !== "python") {
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

/**
 * Extract just the target method body so we can estimate Big-O.
 * This is a heuristic (NOT a formal proof) but it matches the simple reporting style you show in the console.
 */
export function extractMethodBody(fullCode: string, methodName: string): string {
  // Find the method signature line (very forgiving regex).
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

  // Walk forward and capture braces to isolate the method block.
  let brace = 0;
  let started = false;
  const out: string[] = [];

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    for (const ch of line) {
      if (ch === "{") {
        brace++;
        started = true;
      } else if (ch === "}") {
        brace--;
      }
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
      STRING_BUILDER: "String Concatenation → StringBuilder",
      NESTED_LOOPS: "Nested Loops Optimization",
      SORTING_IN_LOOP: "Sorting Moved Out of Loop",
      SORTING: "Redundant Sorting Removal",
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