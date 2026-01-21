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
  // 4. Extraction & Validation
  const patch = parseAiResponse(rawAiResponse);

  // 🛡️ NO-OP CHECK: The "Logic Gate"
  // We strip comments and all whitespace to see if the execution logic changed.
  // This catches "Shuffled Lines" where AI moves code but doesn't refactor.
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
  smellType: string, // Added smellType
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
          "You are a senior Java engineer focused on Big-O optimization for Green Computing.",
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
 * Keeping these separate allows for easy expansion without touching prompt logic.
 */
function getTaskInstructions(smellType: string): string {
  const TaskLibrary: Record<string, string> = {
    RECURSION:
      "Refactor recursion to a PURE iterative loop (for/while). DO NOT use memoization, HashMaps, or any secondary storage. Achieve O(1) space complexity by using only primitive variables (int/long) and completely removing self-calls.",
    NESTED_LOOPS:
      "Optimize O(N^2) complexity to O(N) or better using efficient data structures like HashSet/HashMap.",
    STRING_BUILDER:
      "Replace String concatenation inside loops with StringBuilder. Avoid using '+' on Strings inside loops. Preserve logic and output.",
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
- **Edge Cases**: Ensure all edge cases (null checks, empty lists, base cases) are preserved.

### IMPORT RULES (CRITICAL)
- **Maintain Current Header**: You MUST include the existing package and import statements provided below at the very top of your response.
- **Library Autonomy**: You are free to use ANY standard java.util or java.io classes required for the most energy-efficient solution.
- **Auto-Include New Imports**: If your optimization uses classes not present in the original header (e.g., StringBuilder, Map, Set, Collections), you MUST explicitly add their full import statements to the header.
- **Full File Output**: Your "Preview" section MUST contain the complete, compilable Java file (Imports + Class).
### DATA FOR REFACTORING
**Existing Header/Imports:**
${imports}

**Target Code Block:**
\`\`\`java
${code}
\`\`\`

### OUTPUT FORMAT
Preview:
\`\`\`java
(The ENTIRE file: existing header + any new imports + the optimized class)
\`\`\`

Reason:
(Technical explanation of the complexity improvement and why this is greener.")
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

  // 🛡️ CLEANING LOGIC: Remove stray words like a leading 'public'
  // that isn't part of the class declaration.
  if (
    preview.startsWith("public") &&
    !preview.match(/^public\s+(class|final|abstract|interface|@interface|enum)/)
  ) {
    // If it starts with 'public' but isn't a class definition,
    // it's likely a hallucinated word before the imports.
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
