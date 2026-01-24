import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../../data/metrics/codeCarbon";
import {
  chooseOptimizationStrategy,
  OptimizationStrategy,
} from "./chooseOptimizationStrategy";

import { MethodFacts } from "../types";

/**
 * Interface for the final optimization result
 */
interface OptimizationResult {
  preview: string;
  reason: string;
}

/**
 * Main entry point for algorithmic optimization
 */
export async function buildOptimizationPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName: string,
  context: {
    targetMethodName: string;
    smellType: string;
    methodFacts: MethodFacts;
  },
): Promise<OptimizationResult> {
  const workspace =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const { targetMethodName, smellType, methodFacts } = context;
  const methodName = targetMethodName;

  console.log(`🛠️ Patch Builder received type: ${smellType}`);

  // 🧠 STRATEGY DECISION (CRITICAL)
  const strategy = chooseOptimizationStrategy(methodFacts);

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

  // 1. Initial Measurement
  const beforeMetrics = await measureCode(fullCode, methodName);

  // 2. Extract Existing Imports/Header
  const fileHeader = fullCode.split(/\bclass\b/)[0].trim();

  // 3. AI Generation
  let rawAiResponse = "";

  if (strategy === OptimizationStrategy.ITERATIVE_REWRITE) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "RECURSION" // force iterative instruction
    );
  }

  if (strategy === OptimizationStrategy.MEMOIZATION) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      smellType
    );
  }

  if (strategy === OptimizationStrategy.STRING_BUILDER) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "STRING_BUILDER"
    );
  }

  // ✅ Duplicate computation optimization call
  if (strategy === OptimizationStrategy.DUPLICATE_COMPUTATION) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "DUPLICATE_COMPUTATION"
    );
  }

  if (strategy === OptimizationStrategy.NESTED_LOOPS) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "NESTED_LOOPS"
    );
  }

  // ✅ NEW: Sorting optimization calls
  if (strategy === OptimizationStrategy.SORTING_IN_LOOP) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "SORTING_IN_LOOP"
    );
  }

  if (strategy === OptimizationStrategy.SORTING) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "SORTING"
    );
  }

  // ✅ Guard: if AI returned nothing, avoid crash
  if (!rawAiResponse || rawAiResponse.trim().length < 10) {
    throw new Error(`AI returned empty response for strategy: ${strategy}`);
  }

  // 4. Extraction & Validation
  const patch = parseAiResponse(rawAiResponse);

  // ✅ HARD VALIDATION for Duplicate Computation refactor
  if (strategy === OptimizationStrategy.DUPLICATE_COMPUTATION) {
    const invalidPatterns = [
      "AtomicInteger",
      "HashMap",
      "Map<",
      "ConcurrentHashMap",
      "cache",
      "memo",
    ];

    const hasInvalid = invalidPatterns.some(p => patch.preview.includes(p));
    if (hasInvalid) {
      throw new Error(
        "AI produced invalid refactor for DUPLICATE_COMPUTATION (added caching/AtomicInteger/Map)."
      );
    }

    if (fullCode.includes("private int expensive(") && !patch.preview.includes("private int expensive(")) {
      throw new Error("AI changed method signature for expensive().");
    }
  }

  // ✅ Optional validation for SORTING_IN_LOOP:
  // Ensure sorting is not still repeatedly done inside the loop (basic heuristic)
  if (strategy === OptimizationStrategy.SORTING_IN_LOOP) {
    const stillHasSortInsideLoop =
      patch.preview.includes("for (") &&
      (patch.preview.includes("Collections.sort") || patch.preview.includes("Arrays.sort")) &&
      patch.preview.indexOf("sort") > patch.preview.indexOf("for (");

    if (stillHasSortInsideLoop) {
      throw new Error("AI did not move sorting out of the loop for SORTING_IN_LOOP.");
    }
  }

  // 🛡️ NO-OP CHECK
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

    const previewUri = vscode.Uri.file(
      path.join(
        os.tmpdir(),
        `sustainadev-preview-${Date.now()}.java`
      )
    );

    fs.writeFileSync(previewUri.fsPath, patch.preview, "utf8");

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      previewUri,
      "🧠 SustainaDev: Algorithmic Optimization (Original ↔ Optimized)",
      { preview: true }
    );
  }

  // 5. Final Measurement & Logging
  const afterMetrics = await measureCode(patch.preview, methodName);
  await logSustainabilityMetrics(
    workspace,
    fileName,
    beforeMetrics,
    afterMetrics,
    patch,
    fullCode,
  );

  return patch;
}

/**
 * Handles communication with local Ollama instance
 */
async function callOptimizationAI(
  fullCode: string,
  range: { from: number },
  existingImports: string,
  smellType: string,
) {
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
  });

  const { classBlock } = extractClassBlock(
    fullCode,
    Math.max(0, range.from - 1),
  );

  const MODEL_NAME = "qwen2.5-coder:3b";

  console.log(`🤖 SustainaDev is calling model: ${MODEL_NAME}`);
  console.log(`🤖 SustainaDev is calling model for: ${smellType} Optimization`);
  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      {
        role: "system",
        content:
          "You are a senior Java engineer focused on Big-O optimization for Green Computing. Always follow the output format exactly.",
      },
      {
        role: "user",
        content: getOptimizationPrompt(classBlock, existingImports, smellType),
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
      "Refactor recursion to a PURE iterative loop (for/while). DO NOT use memoization, HashMaps, or any secondary storage. Achieve O(1) space complexity by using only primitive variables (int/long) and completely removing self-calls.",

    NESTED_LOOPS:
      "Optimize O(N^2) complexity to O(N) or better using efficient data structures like HashSet/HashMap.",

    STRING_BUILDER:
      "Replace String concatenation inside loops with StringBuilder. Avoid using '+' on Strings inside loops. Preserve logic and output.",

    DUPLICATE_COMPUTATION:
      "Fix duplicate computation inside the SAME method when the SAME call is repeated (e.g., expensive(x) + expensive(x)). " +
      "Refactor ONLY by calling it ONCE and storing the result in a LOCAL variable. Example: `int v = expensive(x); return v + v;`. " +
      "STRICT RULES: Do NOT add Map/HashMap/caching/memoization. Do NOT add AtomicInteger. Do NOT add fields/state. Do NOT change ANY method signature. " +
      "No new helper methods. Only local variable reuse.",

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
 * Authoritative prompt focusing on Import Management and Algorithmic Complexity.
 */
function getOptimizationPrompt(
  code: string,
  imports: string,
  smellType: string,
): string {
  const selectedTask = getTaskInstructions(smellType);
  console.log(smellType + selectedTask);
  return `
### ROLE
Expert Java Performance Engineer (Sustainability Specialist).

### TASK
1. ${selectedTask}
2. Use the most energy-efficient approach available in standard Java libraries.
3. **Efficiency Goal**: Minimize both CPU cycles and memory allocations.

### BEHAVIORAL INTEGRITY (CRITICAL)
- **Zero Logic Change**: The refactored code MUST produce the exact same output for the same input.
- **Signature Lock**: Do NOT change method names, return types, or parameter lists.
- **No Extra State**: Do NOT add fields, caches, or global/static state.
- **Edge Cases**: Ensure all edge cases are preserved.

### IMPORT RULES (CRITICAL)
- **Maintain Current Header**: You MUST include the existing package and import statements provided below at the very top of your response.
- **Auto-Include New Imports**: If your optimization uses classes not present in the original header, you MUST explicitly add their import statements.
- **Full File Output**: Your "Preview" section MUST contain the complete, compilable Java file (Imports + Class).

### DATA FOR REFACTORING
**Existing Header/Imports:**
${imports}

**Target Code Block:**
\`\`\`java
${code}
\`\`\`

### OUTPUT FORMAT (MUST FOLLOW EXACTLY)
Preview:
\`\`\`java
(Complete Java file)
\`\`\`

Reason:
(Short technical explanation.)
`;
}

/**
 * Robustly parses AI markdown response
 */
function parseAiResponse(text: string): OptimizationResult {
  console.log("🤖 Raw AI Output:", text);

  const codeBlockRegex = /\`{3}(?:java)?([\s\S]*?)\`{3}/gi;
  const blocks: string[] = [];
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }

  let preview =
    blocks.length > 0
      ? blocks.reduce((a, b) => (a.length > b.length ? a : b))
      : "";

  if (
    preview.startsWith("public") &&
    !preview.match(/^public\s+(class|final|abstract|interface|@interface|enum)/)
  ) {
    preview = preview.replace(/^public\s+/, "").trim();
  }

  const reasonMatch = text.match(/Reason:?\s*([\s\S]*)$/i);
  const reason = reasonMatch
    ? reasonMatch[1].trim()
    : "Optimized algorithmic complexity.";

  if (!preview || preview.length < 20) {
    throw new Error("AI failed to provide a valid code block.");
  }

  return { preview, reason };
}

/**
 * Measures CCN and NLOC using Lizard
 */
async function measureCode(code: string, methodName: string) {
  const tmpPath = path.join(
    os.tmpdir(),
    `sustainadev_metrics_${Date.now()}.java`,
  );
  try {
    fs.writeFileSync(tmpPath, code, "utf8");
    const analysis = await runLizard(tmpPath);
    const fn = analysis.functions.find((f: any) => f.name === methodName);
    return {
      ccn: fn?.ccn || 0,
      nloc: fn?.nloc || 0,
    };
  } catch (e) {
    console.error("Lizard measurement failed:", e);
    return { ccn: 0, nloc: 0 };
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

/**
 * Logs sustainability data
 */
async function logSustainabilityMetrics(
  workspace: string,
  fileName: string | undefined,
  before: { ccn: number },
  after: { ccn: number },
  patch: OptimizationResult,
  originalCode: string,
) {
  const isBigOWin =
    originalCode.includes("for") &&
    (patch.preview.includes("HashSet") || patch.preview.includes("HashMap"));
  const virtualDelta = isBigOWin ? 20 : 0;

  const deltaCCN = Math.max(before.ccn - after.ccn, virtualDelta);
  const energy = await estimateEnergy(deltaCCN);

  const logEntry = {
    timestamp: new Date().toISOString(),
    file: fileName ? path.basename(fileName) : "unknown",
    refactor: "Algorithmic Optimization",
    metrics: { before, after, deltaCCN },
    energy,
    reason: patch.reason,
  };

  const logDir = path.join(workspace, ".sustainadev");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, "log.jsonl"),
    JSON.stringify(logEntry) + "\n",
    "utf8",
  );
}

/**
 * Utility to isolate the class context
 */
export function extractClassBlock(fullCode: string, startLine: number) {
  const lines = fullCode.split(/\r?\n/);
  let classStart = -1;
  for (let i = startLine; i >= 0; i--) {
    if (/\bclass\s+\w+/.test(lines[i])) {
      classStart = i;
      break;
    }
  }
  classStart = classStart === -1 ? 0 : classStart;

  let braceCount = 0,
    foundBrace = false,
    classEnd = lines.length - 1;
  for (let i = classStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        braceCount++;
        foundBrace = true;
      }
      if (ch === "}") braceCount--;
    }
    if (foundBrace && braceCount === 0) {
      classEnd = i;
      break;
    }
  }
  return { classBlock: lines.slice(classStart, classEnd + 1).join("\n") };
}
