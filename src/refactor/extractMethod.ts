// extractMethod.ts — with proper metrics logging (file-level CCN/NLOC sums)
import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../metrics/codeCarbon";

/**
 * Performs Extract Method refactoring with full metrics tracking and logging
 */
export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string,
  context?: { methodBody?: string; locals?: string[] }
): Promise<{ preview: string; newMethod: string; callName: string }> {
  
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const actualFileName = fileName || "UnknownFile.java";

  // ---------------- BEFORE METRICS (file-level sums) ----------------
  // Write ORIGINAL code to temp file for accurate Lizard measurement
  const tmpBefore = path.join(os.tmpdir(), `sustainadev_extract_before_${Date.now()}.java`);
  fs.writeFileSync(tmpBefore, fullCode, "utf8");
  
  const beforeLizard = await safeRunLizard(tmpBefore);
  console.log(`🔍 Lizard BEFORE returned:`, JSON.stringify(beforeLizard, null, 2));
  const beforeTotals = aggregateFileMetrics(beforeLizard);
  const before = beforeTotals || { ccn: 0, nloc: 0 };

  console.log(`📊 Before Extract Method: File CCN=${before.ccn}, NLOC=${before.nloc}`);
  
  // Cleanup temp file
  try {
    fs.unlinkSync(tmpBefore);
  } catch (e) {
    console.warn("Could not delete temp before file:", e);
  }

  // ---------------- AI Extraction Logic ----------------
  const client = new OpenAI({
    apiKey:
      "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",
    project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
  });

  const adjustedFrom = Math.max(0, range.from - 1);
  const adjustedTo = range.to;

  const { classBlock } = extractClassBlock(fullCode, adjustedFrom);

  const prompt = `
You are a senior Java refactoring engineer performing an **Extract Method** refactoring.

### Task
Analyze the following Java class and identify ONE cohesive code block within the target method that should be extracted into a new private method.

### Selection Criteria (IMPORTANT)
Choose a block that is:
- **Cohesive**: Performs a single, well-defined task (e.g., printing output, validation logic, calculation)
- **Safe to extract**: Does NOT modify variables that are used later in the parent method
- **Meaningful**: At least 3–5 lines that would benefit from being a separate method
- **Pure or side-effect limited**: Prefer blocks that only read data or produce output
- Do NOT move statements that appear outside a loop to inside the loop.
- The extracted method must preserve the same control flow and logical order.
- Never call the new method from inside a loop if it was previously called after the loop.

### What NOT to Extract
- Single lines (not worth extracting)
- Code with complex control flow that spans the entire method
- Code that would require too many parameters (>4)

### Refactoring Requirements
- Modify ONLY code inside this class.
- Keep imports, outer braces, and all existing methods untouched.
- Insert exactly **one** new private method.
- Maintain correct braces and indentation (4 spaces per level).
- Replace the selected lines with a call to the new method at the same location.
- Pass necessary variables as parameters.
- **If the extracted block modifies variables declared outside it (e.g., accumulators, counters), 
  return those updated variables as part of an array (e.g., \`return new int[]{var1, var2}\`) 
  and unpack them at the call site.**
- Preserve identical functionality — the result should behave the same as before extraction.
- The output must be valid, compilable Java code.
- If the target method already delegates its main logic to another helper (e.g., calls another private method doing the main loop or calculation), DO NOT extract again.
- Do not extract trivial helper methods that only wrap a loop or return primitive accumulators (e.g., total and count) 
  UNLESS the loop was originally inside a larger method that also handles other tasks (like printing or calculating).

---

### Input
File: ${actualFileName}
Target method is between lines: ${range.from}–${range.to}

### Full class:
\`\`\`java
${classBlock}
\`\`\`

### Target Method Context
Below is the **full method** that contains the target code block:

\`\`\`java
${context?.methodBody ?? "N/A"}
\`\`\`

Local variables in scope: ${context?.locals?.join(", ") || "none"}

The code to extract lies between lines ${range.from}–${range.to}.
You MUST replace those lines with a call to the new method at the same position inside the same parent method.

---

### Output Format (strict)
Respond ONLY with the formatted output below.  
Do not include any explanations, commentary, or markdown outside the specified format.  
If no good extraction candidate exists, respond with:
Call Name: none
Preview: none
New Method: none

Preview:
\`\`\`java
(full updated class with ONE new method inserted and the extracted lines replaced by a call)
\`\`\`
New Method:
\`\`\`java
(only the new method)
\`\`\`
Call Name:
(newMethodNameOnly)
Extracted Lines:
(start–end line numbers of what you extracted, e.g., "38–42")
Reason:
(one sentence explaining why this block was chosen)
---
`;

  // ✅ Use a system message to reset model context
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a stateless Java refactoring expert. Treat every request as a clean slate — never remember or reuse past code. Only modify what is in the current prompt.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.0,
    max_tokens: 5000,
  });

  const text = resp.choices?.[0]?.message?.content ?? "";

  const preview = extractSection(text, "Preview");
  const newMethod = extractSection(text, "New Method");
  const callName = extractLabelValue(text, "Call Name");
  const extractedLines = extractLabelValue(text, "Extracted Lines");
  const reason = extractLabelValue(text, "Reason");

  // 🧩 Ensure AI output contains only ONE class
  const classCount = (preview.match(/\bclass\s+\w+/g) || []).length;
  if (classCount > 1) {
    vscode.window.showErrorMessage(
      `⚠️ AI output contains ${classCount} class definitions But will continue`
    );
  }

  if (!preview || !newMethod || !callName) {
    vscode.window.showErrorMessage("AI output missing sections.");
    throw new Error("Incomplete AI response");
  }

  if (!extractedLines || extractedLines === "none") {
    vscode.window.showInformationMessage(
      "AI couldn't find a good extraction candidate in this method."
    );
    throw new Error("AI couldn't find extraction candidate");
  }

  if (!isBalanced(preview)) {
    vscode.window.showWarningMessage(
      "⚠️ AI output braces unbalanced — review before applying."
    );
  }

  // Optional: Log what the AI decided to extract
  console.log(`AI extracted lines ${extractedLines}: ${reason}`);

  // ---------------- AFTER METRICS (file-level sums) ----------------
  // Write refactored code to a temp file for Lizard analysis
  const tmpAfter = path.join(os.tmpdir(), `sustainadev_extract_after_${Date.now()}.java`);
  fs.writeFileSync(tmpAfter, preview, "utf8");

  const afterLizard = await safeRunLizard(tmpAfter);
  console.log(`🔍 Lizard AFTER returned:`, JSON.stringify(afterLizard, null, 2));
  const afterTotals = aggregateFileMetrics(afterLizard);
  const after = afterTotals || { ccn: 0, nloc: 0 };

  console.log(`📊 After Extract Method: File CCN=${after.ccn}, NLOC=${after.nloc}`);

  // Cleanup temp file
  try {
    fs.unlinkSync(tmpAfter);
  } catch (e) {
    console.warn("Could not delete temp file:", e);
  }

  // ---------------- COMPUTE DELTA & LOG ----------------
  // For Extract Method, complexity typically stays same or slightly changes
  // But we track the actual delta
  const delta = {
    ccn: after.ccn - before.ccn, // Can be positive or negative
    nloc: after.nloc - before.nloc,
  };

  const energy = await estimateEnergy(Math.abs(delta.ccn));

  const logPath = path.join(workspace, ".sustainadev", "log.jsonl");
  const logEntry = {
    timestamp: new Date().toISOString(),
    file: actualFileName,
    refactor: "Extract Method",
    before,
    after,
    delta,
    verify: { refminer: false },
    energy,
    commit: {
      message: `Extract Method in ${callName}: CCN ${before.ccn}→${after.ccn}, NLOC ${before.nloc}→${after.nloc}`,
    },
  };

  // Ensure directory exists
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.warn("Could not ensure .sustainadev dir exists:", e);
  }

  // Append to log
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n", "utf8");

  console.log(
    `✅ Extract Method logged! Delta: CCN=${delta.ccn}, NLOC=${delta.nloc}`
  );

  return { preview, newMethod, callName };
}

/* ---------------- Helper functions ---------------- */

export function extractClassBlock(fullCode: string, functionStart: number) {
  const lines = fullCode.split(/\r?\n/);
  let classStart = -1;
  let classEnd = lines.length - 1;

  // find the nearest "class" declaration before the function start
  for (let i = functionStart - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (/^(public|private|protected)?\s*class\s+\w+/.test(trimmed)) {
      classStart = i;
      break;
    }
  }
  if (classStart === -1) throw new Error("Could not find class declaration.");

  // find matching closing brace for that class
  let braceCount = 0;
  let foundBrace = false;
  for (let i = classStart; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === "{") {
        braceCount++;
        foundBrace = true;
      } else if (ch === "}") {
        braceCount--;
      }
    }
    if (foundBrace && braceCount === 0) {
      classEnd = i;
      break;
    }
  }

  const classBlock = lines.slice(classStart, classEnd + 1).join("\n");
  return { classBlock, classStart, classEnd };
}

function extractSection(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\``, "i");
  const match = output.match(re);
  if (!match) return "";
  return match[0]
    .replace(new RegExp(`${label}:`, "i"), "")
    .replace(/```java/i, "")
    .replace(/```/g, "")
    .trim();
}

function extractLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim().split(/\s+/)[0] : "";
}

function isBalanced(code: string): boolean {
  let count = 0;
  for (const ch of code) {
    if (ch === "{") count++;
    else if (ch === "}") count--;
    if (count < 0) return false;
  }
  return count === 0;
}

/**
 * Safely run Lizard, returning empty result on failure
 */
async function safeRunLizard(file: string) {
  try {
    return await runLizard(file);
  } catch (e) {
    console.error("⚠️ Lizard failed on", file, e);
    return { functions: [] };
  }
}

/**
 * Aggregates Lizard results into file-level totals (sum of all functions)
 */
function aggregateFileMetrics(lizardRes: any): { ccn: number; nloc: number } {
  console.log(`🔧 Aggregating metrics from:`, lizardRes);
  
  if (!lizardRes || !Array.isArray(lizardRes.functions)) {
    console.warn(`⚠️ Invalid Lizard result - no functions array found`);
    return { ccn: 0, nloc: 0 };
  }

  if (lizardRes.functions.length === 0) {
    console.warn(`⚠️ Lizard returned 0 functions`);
    return { ccn: 0, nloc: 0 };
  }

  const totals = lizardRes.functions.reduce(
    (acc: { ccn: number; nloc: number }, fn: any) => {
      const ccn = Number(fn.ccn ?? 0);
      const nloc = Number(fn.nloc ?? 0);
      console.log(`  - Function "${fn.name}": CCN=${ccn}, NLOC=${nloc}`);
      acc.ccn += isNaN(ccn) ? 0 : ccn;
      acc.nloc += isNaN(nloc) ? 0 : nloc;
      return acc;
    },
    { ccn: 0, nloc: 0 }
  );

  console.log(`✅ Aggregated totals: CCN=${totals.ccn}, NLOC=${totals.nloc}`);
  return totals;
}