// renameVariable.ts — performs Rename Variable refactoring with metrics + logging

import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../metrics/codeCarbon";

export async function buildRenamePatch(
  fullCode: string,
  oldName: string,
  newName: string,
  fileName?: string
): Promise<{ preview: string; renamed: string }> {
  const workspace =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  const actualFileName = fileName || "UnknownFile.java";

  //  ---------------- BEFORE METRICS ----------------
  const tmpBefore = path.join(
    os.tmpdir(),
    `sustainadev_rename_before_${Date.now()}.java`
  );
  fs.writeFileSync(tmpBefore, fullCode, "utf8");

  const beforeLizard = await safeRunLizard(tmpBefore);
  const beforeTotals = aggregateFileMetrics(beforeLizard);
  const before = beforeTotals || { ccn: 0, nloc: 0 };

  console.log(
    `📊 Before Rename Variable: File CCN=${before.ccn}, NLOC=${before.nloc}`
  );

  try {
    fs.unlinkSync(tmpBefore);
  } catch {}

  // ---------------- AI Rename Logic ----------------
  const client = new OpenAI({
    apiKey:
      "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",
    project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
  });

  const { classBlock } = extractClassBlock(fullCode, 0);

  const prompt = `
You are a Java refactoring expert performing a **Rename Variable** operation.

### Task
Rename the variable \`${oldName}\` to \`${newName}\` **safely** throughout the entire class, including the method, loops, and any references.

In addition, you must **rename any related function names** that contain \`${oldName}\` to reflect the new variable name \`${newName}\`. For example, rename functions like \`calculateTotalAndCount\` to \`calculateSumAndCount\`.

Make sure that you do not rename the variable in comments, strings, or other places where it shouldn't be modified. Only rename valid variable occurrences in the code.

### Selection Criteria
- Rename all valid occurrences of \`${oldName}\` to \`${newName}\` in the provided class.
- Ensure that the renamed variable does not conflict with other variable names or change the functionality of the code.

### Refactoring Requirements
- Modify ONLY the variable occurrences in the class.
- Do not modify comments, string literals, or method signatures.
- Maintain the same functionality as before, ensuring that the renamed variable is updated in all valid places.

---

### Input
File: ${fileName ?? "Unknown.java"}
Target variable to rename: \`${oldName}\` → \`${newName}\`

### Full class:
\`\`\`java
${classBlock}
\`\`\`

### Target Method Context
Below is the **full method** that contains the target variable:



---

### Output Format (strict)
Respond ONLY with the formatted output below. Do not include any explanations, commentary, or markdown outside the specified format. If no good renaming candidate exists, respond with:

Preview: none  
Renamed Variable: none  
Reason: none

Preview:
\`\`\`java
(full updated code with renamed variable)
\`\`\`

Renamed Variable:
${oldName} -> ${newName}

Reason:
(one sentence explaining why this variable was renamed)

---
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a stateless Java refactoring expert.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.0,
    max_tokens: 4000,
  });

  const text = resp.choices?.[0]?.message?.content ?? "";
  console.log("🔍 Raw AI Response:", text);

  const preview = extractSection(text, "Preview");
  const renamed = extractLabelValue(text, "Renamed Variable");
  const reason = extractLabelValue(text, "Reason");

  if (!preview || preview === "none") {
    vscode.window.showInformationMessage(
      "AI couldn't find valid variable to rename."
    );
    throw new Error("AI couldn't rename variable");
  }

  // ---------------- AFTER METRICS ----------------
  const tmpAfter = path.join(
    os.tmpdir(),
    `sustainadev_rename_after_${Date.now()}.java`
  );
  fs.writeFileSync(tmpAfter, preview, "utf8");

  const afterLizard = await safeRunLizard(tmpAfter);
  const afterTotals = aggregateFileMetrics(afterLizard);
  const after = afterTotals || { ccn: 0, nloc: 0 };

  console.log(
    `📊 After Rename Variable: File CCN=${after.ccn}, NLOC=${after.nloc}`
  );

  try {
    fs.unlinkSync(tmpAfter);
  } catch {}

  // ---------------- LOGGING ----------------
  const delta = {
    ccn: after.ccn - before.ccn,
    nloc: after.nloc - before.nloc,
  };

  const energy = await estimateEnergy(Math.abs(delta.ccn));

  const logPath = path.join(workspace, ".sustainadev", "log.jsonl");
  const logEntry = {
    timestamp: new Date().toISOString(),
    file: actualFileName,
    refactor: "Rename Variable",
    renamed,
    before,
    after,
    delta,
    energy,
    reason,
  };
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.warn("Could not ensure .sustainadev dir exists:", e);
  }
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n", "utf8");

  console.log(
    `✅ Rename Variable logged! Delta: CCN=${delta.ccn}, NLOC=${delta.nloc}`
  );

  return { preview, renamed };
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
