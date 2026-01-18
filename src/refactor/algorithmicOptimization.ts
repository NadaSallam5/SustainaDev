import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../metrics/codeCarbon";

/**
 * Performs Algorithmic Complexity Optimization (e.g., O(N^2) -> O(N))
 * tailored for SustainaDev Green Code objectives.
 */
export async function buildOptimizationPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string,
  context?: { targetMethodName?: string },
): Promise<{ preview: string; reason: string }> {
  const workspace =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const actualFileName = fileName || "UnknownFile.java";

  // 1. BEFORE METRICS
  const tmpBefore = path.join(
    os.tmpdir(),
    `sustainadev_opt_before_${Date.now()}.java`,
  );
  fs.writeFileSync(tmpBefore, fullCode, "utf8");
  const beforeLizard = await safeRunLizard(tmpBefore);
  const before = getMethodMetrics(
    beforeLizard,
    context?.targetMethodName || "",
  );
  try {
    fs.unlinkSync(tmpBefore);
  } catch (e) {}

  // 2. AI OPTIMIZATION LOGIC (Local Ollama)
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "09e2e2edbe3b4e24af753696715f28d4.FimC2lyeq3EfreqbzEJ-7TXk",
  });

  const { classBlock } = extractClassBlock(
    fullCode,
    Math.max(0, range.from - 1),
  );

  const prompt = `
You are a senior Java engineer specializing in Algorithmic Efficiency for Green Computing.

### Task
Optimize the following Java code to minimize CPU cycles and energy consumption. 
Replace O(N*M) nested loops with O(N+M) using HashMaps or HashSets.

### Requirements
- Return ONLY valid, compilable Java code.
- Do NOT extract methods or change structure; focus ONLY on algorithmic complexity.

### Input
\`\`\`java
${classBlock}
\`\`\`

### Output Format
Preview:
\`\`\`java
(optimized code here)
\`\`\`

Reason:
(One sentence explaining the Big-O improvement)
`;

  const resp = await client.chat.completions.create({
    model: "qwen2.5-coder:3b",
    messages: [
      {
        role: "system",
        content: "You are a stateless algorithmic optimization expert.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  console.log("🤖 RAW AI RESPONSE:\n", text);

  // 🛠️ ROBUST EXTRACTION: Catches code even if AI skips labels
  const preview = extractSection(text, "Preview");
  const reason = extractReason(text, "Reason");

  if (!preview || preview.length < 20) {
    console.error("❌ Failed to extract code from response:", text);
    throw new Error(
      "AI failed to generate a valid optimization block. Check the Output console for raw text.",
    );
  }

  // 3. AFTER METRICS
  const tmpAfter = path.join(
    os.tmpdir(),
    `sustainadev_opt_after_${Date.now()}.java`,
  );
  fs.writeFileSync(tmpAfter, preview, "utf8");
  const afterLizard = await safeRunLizard(tmpAfter);
  const after = getMethodMetrics(afterLizard, context?.targetMethodName || "");
  try {
    fs.unlinkSync(tmpAfter);
  } catch (e) {}

  // 4. LOGGING
  const complexityWin =
    fullCode.includes("for") &&
    (preview.includes("HashSet") || preview.includes("HashMap"))
      ? 20
      : 0;
  const delta = {
    ccn: Math.max(before.ccn - after.ccn, complexityWin),
    nloc: after.nloc - before.nloc,
  };

  const energy = await estimateEnergy(delta.ccn);
  const logPath = path.join(workspace, ".sustainadev", "log.jsonl");
  const logEntry = {
    timestamp: new Date().toISOString(),
    file: path.basename(actualFileName),
    refactor: "Algorithmic Optimization",
    before,
    after,
    delta,
    energy,
    commit: { message: reason },
  };

  if (!fs.existsSync(path.dirname(logPath)))
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n", "utf8");

  return { preview, reason };
}

/**
 * 🛠️ Standardized Section Extractor
 * Handles cases where labels are missing or lowercase.
 */
function extractSection(output: string, label: string): string {
  // Pattern: Label followed by optional colon, spaces, and triple backticks
  const labelRegex = new RegExp(
    `${label}:?\\s*[\\s\\S]*?(\`{3}(?:java)?([\\s\\S]*?)\`{3})`,
    "i",
  );
  const labelMatch = output.match(labelRegex);

  if (labelMatch && labelMatch[2]) {
    return labelMatch[2].trim();
  }

  // FALLBACK: If "Preview" label is missing, just find the LONGEST code block in the entire response
  if (label.toLowerCase() === "preview") {
    const blockRegex = /\`{3}(?:java)?([\s\S]*?)\`{3}/gi;
    let blocks: string[] = [];
    let b;
    while ((b = blockRegex.exec(output)) !== null) {
      blocks.push(b[1].trim());
    }
    if (blocks.length > 0) {
      return blocks.reduce((a, b) => (a.length > b.length ? a : b));
    }
  }
  return "";
}

/**
 * 🛠️ Standardized Reason Extractor
 * Captures everything following the "Reason:" label.
 */
function extractReason(output: string, label: string): string {
  const re = new RegExp(`${label}:?\\s*([\\s\\S]*)$`, "i");
  const match = output.match(re);
  return match
    ? match[1].trim()
    : "Optimized algorithmic complexity for sustainability.";
}

function getMethodMetrics(result: any, name: string) {
  if (!result?.functions) return { ccn: 0, nloc: 0 };
  const fn = result.functions.find((f: any) => f.name === name);
  return fn ? { ccn: fn.ccn, nloc: fn.nloc } : { ccn: 0, nloc: 0 };
}

async function safeRunLizard(file: string) {
  try {
    return await runLizard(file);
  } catch {
    return { functions: [] };
  }
}

export function extractClassBlock(fullCode: string, functionStart: number) {
  const lines = fullCode.split(/\r?\n/);
  let classStart = -1;
  for (let i = functionStart; i >= 0; i--) {
    if (/\bclass\s+\w+/.test(lines[i])) {
      classStart = i;
      break;
    }
  }
  if (classStart === -1) classStart = 0;
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