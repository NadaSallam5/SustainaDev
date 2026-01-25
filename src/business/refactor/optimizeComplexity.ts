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

  // 1. Estimate algorithmic complexity BEFORE using methodFacts
  const beforeBigO = estimateBigOFromMethodFacts(methodFacts, "BEFORE");
  console.log(`📊 BEFORE Big-O (from MethodFacts): ${beforeBigO}`);

  // 2. Extract Existing Imports/Header
  const fileHeader = fullCode.split(/\bclass\b/)[0].trim();

  // 3. AI Generation
  let rawAiResponse = "";

  if (strategy === OptimizationStrategy.ITERATIVE_REWRITE) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "RECURSION"
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

  if (strategy === OptimizationStrategy.NESTED_LOOPS) {
    rawAiResponse = await callOptimizationAI(
      fullCode,
      range,
      fileHeader,
      "NESTED_LOOPS"
    );
  }

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

  // 4. Extraction & Validation
  const patch = parseAiResponse(rawAiResponse);

  // ✅ Validation for SORTING_IN_LOOP
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
  const logicOnlyPatch = patch.preview.replace(/\/\/.*|\/\*[\s\S]*?\*\/|\s/g, "");

  if (logicOnlyOriginal === logicOnlyPatch) {
    vscode.window.showInformationMessage("✅ Code logic is already optimized.");
    throw new Error("ALREADY_OPTIMIZED");
  }

  // 🔍 SHOW PREVIEW
  if (fileName) {
    const originalUri = vscode.Uri.file(fileName);
    const previewUri = vscode.Uri.file(
      path.join(os.tmpdir(), `sustainadev-preview-${Date.now()}.java`)
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

  // 5. ✅ CRITICAL FIX: Estimate AFTER complexity from the optimized code
  const afterBigO = estimateBigOFromCode(patch.preview, methodName, strategy);
  console.log(`📊 AFTER Big-O (from optimized code): ${afterBigO}`);

  // 6. Log the optimization
  await logAlgorithmicOptimization(
    workspace,
    fileName,
    {
      metric: "time",
      before: beforeBigO,
      after: afterBigO,
    },
    patch.reason,
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
    apiKey: "788f53b2d7f94995a5b453ad91aa05e6.ukm_ArZmxq4kqhPq5qCxoKcR",
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
 * ✅ NEW: Estimate Big-O from MethodFacts (BEFORE optimization)
 */
function estimateBigOFromMethodFacts(facts: MethodFacts, phase: string): string {
  console.log(`📊 Estimating Big-O for ${phase}:`, JSON.stringify(facts, null, 2));

  // SORTING_IN_LOOP: O(n² log n) before optimization
  if (facts.sortInsideLoop) {
    console.log(`✅ ${phase}: Detected sortInsideLoop → O(n² log n)`);
    return "O(n² log n)";
  }

  // SORTING: O(n log n) if just sorting once
  if (facts.hasSortingCall && !facts.sortInsideLoop) {
    console.log(`✅ ${phase}: Detected hasSortingCall (not in loop) → O(n log n)`);
    return "O(n log n)";
  }

  // RECURSION
  if (facts.callsSelf) {
    const recursiveCalls = facts.recursiveCallCount || 1;
    if (recursiveCalls >= 2) {
      console.log(`✅ ${phase}: Multiple recursive calls → O(2^n)`);
      return "O(2^n)";
    }
    console.log(`✅ ${phase}: Single recursive call → O(n)`);
    return "O(n)";
  }

  // NESTED LOOPS
  if (facts.maxLoopDepth >= 3) {
    console.log(`✅ ${phase}: Loop depth ${facts.maxLoopDepth} → O(n^3)`);
    return "O(n^3)";
  }
  if (facts.maxLoopDepth === 2) {
    console.log(`✅ ${phase}: Loop depth 2 → O(n^2)`);
    return "O(n^2)";
  }
  if (facts.maxLoopDepth === 1) {
    console.log(`✅ ${phase}: Loop depth 1 → O(n)`);
    return "O(n)";
  }

  // Default
  console.log(`✅ ${phase}: No loops/recursion → O(1)`);
  return "O(1)";
}

/**
 * ✅ FIXED: Estimate Big-O from optimized code (AFTER optimization)
 */
function estimateBigOFromCode(
  fullCode: string,
  methodName: string,
  strategy: OptimizationStrategy
): string {
  const method = extractMethodBody(fullCode, methodName);
  const cleaned = method
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();

  console.log(`📊 Analyzing AFTER code for strategy: ${strategy}`);
  console.log(`📄 Method body (cleaned): ${cleaned.substring(0, 200)}...`);

  // ✅ CRITICAL: Check if sorting was moved outside loop
  if (strategy === OptimizationStrategy.SORTING_IN_LOOP) {
    const hasSortOutsideLoop =
      (cleaned.includes("Collections.sort") || cleaned.includes("Arrays.sort")) &&
      !isSortInsideLoop(cleaned);

    if (hasSortOutsideLoop) {
      console.log(`✅ AFTER: Sorting moved outside loop → O(n log n)`);
      return "O(n log n)";
    }

    // If no sorting found, might be replaced with linear scan
    if (!cleaned.includes("sort")) {
      console.log(`✅ AFTER: Sorting replaced with linear scan → O(n)`);
      return "O(n)";
    }
  }

  // ✅ SORTING strategy: should remain O(n log n)
  if (strategy === OptimizationStrategy.SORTING) {
    if (cleaned.includes("Collections.sort") || cleaned.includes("Arrays.sort")) {
      console.log(`✅ AFTER: Sorting optimized → O(n log n)`);
      return "O(n log n)";
    }
  }

  // ✅ ITERATIVE_REWRITE: Should be O(n) after removing recursion
  if (strategy === OptimizationStrategy.ITERATIVE_REWRITE) {
    const bodyOnly = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{") + 1) : cleaned;
    const selfCalls = (bodyOnly.match(new RegExp(`\\b${methodName}\\s*\\(`, "g")) || []).length;

    if (selfCalls === 0) {
      console.log(`✅ AFTER: Recursion removed → O(n)`);
      return "O(n)";
    }
  }

  // Default loop-based analysis
  const loopDepth = calculateLoopDepth(method);

  if (loopDepth >= 3) return "O(n^3)";
  if (loopDepth === 2) return "O(n^2)";
  if (loopDepth === 1) return "O(n)";

  return "O(1)";
}

/**
 * ✅ Helper: Check if sorting is inside a loop
 */
function isSortInsideLoop(code: string): boolean {
  const lines = code.split(/[;{}]/);
  let insideLoop = false;
  let braceDepth = 0;

  for (const line of lines) {
    if (/\b(for|while)\s*\(/.test(line)) {
      insideLoop = true;
    }

    if (insideLoop && (line.includes("Collections.sort") || line.includes("Arrays.sort"))) {
      return true;
    }

    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") {
        braceDepth--;
        if (braceDepth === 0) insideLoop = false;
      }
    }
  }

  return false;
}

/**
 * Extract method body
 */
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

/**
 * Calculate loop nesting depth
 */
function calculateLoopDepth(code: string): number {
  let brace = 0;
  const loopStack: number[] = [];
  let maxLoopDepth = 0;

  const tokens = code.split(/\r?\n/);
  for (const line of tokens) {
    const l = line.replace(/\/\/.*$/, "");

    if (/\b(for|while)\s*\(/.test(l)) {
      loopStack.push(brace);
      if (loopStack.length > maxLoopDepth) maxLoopDepth = loopStack.length;
    }

    for (const ch of l) {
      if (ch === "{") brace++;
      else if (ch === "}") {
        brace--;
        while (loopStack.length && brace < loopStack[loopStack.length - 1]) {
          loopStack.pop();
        }
      }
    }
  }

  return maxLoopDepth;
}

function bigOToScore(bigO: string): number {
  const s = (bigO || "").replace(/\s+/g, "").toLowerCase();
  if (s.includes("o(1)")) return 1;
  if (s.includes("o(logn)") || s.includes("o(log(n))")) return 2;
  if (s.includes("o(n)") && !s.includes("o(nlogn)") && !s.includes("o(nlog(n))") && !s.includes("o(n^2)") && !s.includes("o(n²)")) return 3;
  if (s.includes("o(nlogn)") || s.includes("o(nlog(n))")) return 4;
  if (s.includes("o(n^2)") || s.includes("o(n2)") || s.includes("o(n²)")) return 5;
  if (s.includes("o(n²logn)") || s.includes("o(n^2logn)") || s.includes("o(n2logn)")) return 6;
  if (s.includes("o(n^3)") || s.includes("o(n3)")) return 7;
  if (s.includes("o(2^n)") || s.includes("o(2n)")) return 8;
  if (s.includes("o(n!)")) return 9;
  return 0;
}

async function logAlgorithmicOptimization(
  workspace: string,
  fileName: string | undefined,
  bigO: { metric: "time"; before: string; after: string },
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

    console.log(`📝 Logging optimization:`, JSON.stringify(logEntry, null, 2));

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