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

/**
 * Interface for the final optimization result
 */
interface OptimizationResult {
  preview: string;
  reason: string;
}

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

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const { targetMethodName, smellType, methodFacts } = context;
  const methodName = targetMethodName;

  console.log(`🛠️ Patch Builder received type: ${smellType}`);

  const strategy = context.smellType as OptimizationStrategy;

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

  if (logicOnlyOriginal === logicOnlyPatch) {
    vscode.window.showInformationMessage("✅ Code logic is already optimized.");
    throw new Error("ALREADY_OPTIMIZED");
  }

  if (fileName) {
    const originalUri = vscode.Uri.file(fileName);
    const ext = path.extname(fileName) || ".java";
    const previewUri = vscode.Uri.file(
      path.join(os.tmpdir(), `sustainadev-preview-${Date.now()}${ext}`)
    );

    fs.writeFileSync(previewUri.fsPath, patch.preview, "utf8");

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      previewUri,
      `🧠 SustainaDev: Algorithmic Optimization (Original ↔ Optimized)`,
      { preview: true }
    );
  }

  return patch;
}

async function callOptimizationAI(
  fullCode: string,
  range: { from: number; to: number },
  existingImports: string,
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

  const response = await client.chat.completions.create({
    model: MODEL_NAME,
    messages: [
      {
        role: "system",
        content: `You are a senior ${targetLanguage} engineer focused on Big-O optimization for Green Computing. Always follow the output format exactly. Output ONLY valid ${targetLanguage} code. Never output Java unless the file language IS Java.`,
      },
      {
        role: "user",
        content: getOptimizationPrompt(classBlock, existingImports, smellType, targetLanguage),
      },
    ],
    temperature: 0.1,
  });

  return response.choices?.[0]?.message?.content ?? "";
}

function getTaskInstructions(smellType: string): string {
  const TaskLibrary: Record<string, string> = {
    RECURSION:
      "Refactor recursion to a PURE iterative loop (for/while). DO NOT use memoization, HashMaps, or any secondary storage. Achieve O(1) space complexity by using only primitive variables and completely removing self-calls.",
    NESTED_LOOPS:
      "Optimize O(N^2) complexity to O(N) or better using efficient data structures like HashSet/HashMap/dict/set depending on the language.",
    STRING_BUILDER:
      "Replace String concatenation inside loops with the most efficient string building approach for the language (StringBuilder for Java, list+join for Python, array+join for JS). Preserve logic and output.",
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
  code: string,
  imports: string,
  smellType: string,
  targetLanguage: string = "Java"
): string {
  const selectedTask = getTaskInstructions(smellType);
  console.log(smellType + selectedTask);
  return `
### ROLE
Expert ${targetLanguage} Performance Engineer (Sustainability Specialist).

### TASK
1. ${selectedTask}
2. Use the most energy-efficient approach available in standard ${targetLanguage} libraries.
3. **Efficiency Goal**: Minimize both CPU cycles and memory allocations.

### BEHAVIORAL INTEGRITY (CRITICAL)
- **Zero Logic Change**: The refactored code MUST produce the exact same output for the same input.
- **Signature Lock**: Do NOT change method names, return types, or parameter lists.
- **No Extra State**: Do NOT add fields, caches, or global/static state.
- **Language Lock**: Output ONLY valid ${targetLanguage} code. Never switch languages.
- **Edge Cases**: Ensure all edge cases are preserved.

### IMPORT RULES (CRITICAL)
- **Maintain Current Header**: You MUST include the existing imports/header provided below at the very top.
- **Auto-Include New Imports**: If your optimization uses new classes/modules, add their imports.
- **Full File Output**: Your "Preview" section MUST contain the complete file.

### DATA FOR REFACTORING
**Existing Header/Imports:**
${imports}

**Target Code Block:**
\`\`\`${targetLanguage.toLowerCase()}
${code}
\`\`\`

### OUTPUT FORMAT (MUST FOLLOW EXACTLY)
Preview:
\`\`\`${targetLanguage.toLowerCase()}
(Complete ${targetLanguage} file)
\`\`\`

Reason:
(Short technical explanation.)
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
  }

  const reasonMatch = text.match(/Reason:?\s*([\s\S]*)$/i);
  const reason = reasonMatch
    ? reasonMatch[1].replace(/```[\s\S]*```/g, "").trim()
    : "Optimized algorithmic complexity.";

  if (!preview || preview.length < 20) {
    throw new Error("AI failed to provide a valid code block.");
  }

  return { preview, reason };
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

// ─── Single definition of OptimizationReport ───────────────────────────────
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