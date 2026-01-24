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

  // 1. Estimate algorithmic complexity BEFORE (same style as the console report)
  const beforeBigO = estimateBigOFromCode(fullCode, methodName);

  // 2. Extract Existing Imports/Header
  // Captures everything from the start of the file up to the class keyword
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

  // 4. Extraction & Validation
  const patch = parseAiResponse(rawAiResponse);
 
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

    const previewUri = vscode.Uri.file(
      path.join(
        os.tmpdir(),
        `sustainadev-preview-${Date.now()}.java`
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
  }

  // 5. Final Measurement & Logging (Algorithmic Big-O)
  const afterBigO = estimateBigOFromCode(patch.preview, methodName);
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
 * Extract just the target method body so we can estimate Big-O.
 * This is a heuristic (NOT a formal proof) but it matches the simple reporting style you show in the console.
 */
function extractMethodBody(fullCode: string, methodName: string): string {
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

function estimateBigOFromCode(fullCode: string, methodName: string): string {
  const method = extractMethodBody(fullCode, methodName);
  const cleaned = method
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Detect recursion calls (exclude the signature by searching after the first "{")
  const bodyOnly = cleaned.includes("{") ? cleaned.slice(cleaned.indexOf("{") + 1) : cleaned;
  const selfCalls = (bodyOnly.match(new RegExp(`\\b${methodName}\\s*\\(`, "g")) || []).length;

  // Loop nesting depth estimation (brace-based heuristic)
  let brace = 0;
  const loopStack: number[] = [];
  let maxLoopDepth = 0;

  const tokens = method.split(/\r?\n/);
  for (const line of tokens) {
    const l = line.replace(/\/\/.*$/, "");
    // entering a loop (very rough but works for typical student code)
    if (/\b(for|while)\s*\(/.test(l)) {
      loopStack.push(brace);
      if (loopStack.length > maxLoopDepth) maxLoopDepth = loopStack.length;
    }

    for (const ch of l) {
      if (ch === "{") brace++;
      else if (ch === "}") {
        // pop loops when leaving their brace scope
        brace--;
        while (loopStack.length && brace < loopStack[loopStack.length - 1]) {
          loopStack.pop();
        }
      }
    }
  }

  // String concatenation inside a loop can behave like O(n^2) due to repeated allocations.
  const hasStringVar = /\bString\s+\w+\s*=/.test(method);
  const stringConcatInLoop = /\b(for|while)\s*\([\s\S]*?\)\s*\{[\s\S]*?(=\s*\w+\s*\+|\+=)\s*[\s\S]*?\}/.test(method);
  if (maxLoopDepth === 1 && hasStringVar && stringConcatInLoop) {
    return "O(n^2)";
  }

  if (maxLoopDepth >= 3) return "O(n^3)";
  if (maxLoopDepth === 2) return "O(n^2)";
  if (maxLoopDepth === 1) return "O(n)";

  // Recursion fallback (very rough)
  if (selfCalls >= 2) return "O(2^n)";
  if (selfCalls === 1) return "O(n)";

  return "O(1)";
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