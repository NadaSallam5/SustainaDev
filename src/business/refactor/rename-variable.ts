// renameVariable.ts — performs Rename Variable refactoring with metrics + logging

import OpenAI from "openai";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runLizard } from "../analyzer/lizardRunner";
import { estimateEnergy } from "../../data/metrics/codeCarbon";

export async function buildRenamePatch(
  fullCode: string,
  oldName: string,
  range: { from: number; to: number },
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

  const adjustedFrom = Math.max(0, range.from - 1);
  console.log("🧩 adjustedFrom =", adjustedFrom);
  console.log("📜 Code near adjustedFrom:\n", fullCode);

  const { classBlock } = extractClassBlock(fullCode, adjustedFrom);

  const prompt = `
You are a Java refactoring expert performing a **Rename Variable** operation.

### Task
Analyze the class below. A variable named \`${oldName}\` is unclear.
1. Suggest 3 better, descriptive variable names (Java-style).
2. Pick the most suitable one and apply it across the code safely.

### Code
\`\`\`java
${classBlock}
\`\`\`

### Constraints
- Do NOT modify logic, strings, or comments.
- Rename variable consistently in all scopes and usages.
- Maintain valid Java syntax.
- Keep only the renamed version in your final preview.

---

### Output Format (strict)
Suggested Names:
["name1", "name2", "name3"]

Preview:
\`\`\`java
(full updated code with chosen rename)
\`\`\`

Renamed Variable:
${oldName} -> (chosen name)

Reason:
(one sentence explaining why the new name was chosen)
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

  const suggestedNames = extractJsonArray(text, "Suggested Names");
  const reason = extractReason(text, "Reason");
  let preview = extractSection(text, "Preview");

  let finalReason = reason; // ✅ Declare globally here
  let aiChosenName = "";
  const renamedLabel = extractFullLabelValue(text, "Renamed Variable");
  if (renamedLabel && renamedLabel.includes("->")) {
    aiChosenName = renamedLabel.split("->")[1].trim();
  }

  // ✅ Let the user pick one of AI's suggested names
  let chosenName: string | undefined;

  if (suggestedNames && suggestedNames.length > 0) {
    chosenName = await vscode.window.showQuickPick(
      [...suggestedNames, "✏️ Enter custom name..."],
      {
        placeHolder: `AI suggested names for "${oldName}"`,
      }
    );

    if (chosenName === "✏️ Enter custom name...") {
      chosenName = await vscode.window.showInputBox({
        prompt: `Enter a custom name for "${oldName}"`,
        placeHolder: "e.g. total, subtotal, average",
      });
    }

    if (!chosenName) {
      vscode.window.showWarningMessage("Rename cancelled by user.");
      throw new Error("User cancelled rename");
    }

    // 🧩 Ensure preview matches user's chosen name
    if (preview) {
      const safeOld = aiChosenName || oldName;
      const regex = new RegExp(`\\b${safeOld}\\b`, "g");
      preview = preview.replace(regex, chosenName);
      console.log(
        `🪄 Replaced all occurrences of '${safeOld}' with '${chosenName}'`
      );
    }

    // 🧠 Adjust reason to reflect user's chosen name instead of AI's
    if (reason && aiChosenName && chosenName) {
      finalReason = reason.replace(
        new RegExp(`\\b${aiChosenName}\\b`, "g"),
        chosenName
      );
    } else {
      finalReason = `Renamed "${oldName}" to "${chosenName}" for clarity.`;
    }

    vscode.window.showInformationMessage(
      `✅ Final rename: ${oldName} → ${chosenName}`
    );

    vscode.window.showInformationMessage(
      `✅ Using "${chosenName}" as new name.`
    );
  } else {
    vscode.window.showWarningMessage(
      "AI provided no suggestions; renaming to fallback."
    );
    chosenName = oldName + "_renamed";
    const regex = new RegExp(`\\b${oldName}\\b`, "g");
    preview = preview.replace(regex, chosenName);
  }

  // 🔍 Validate that preview exists
  if (!preview || preview === "none") {
    vscode.window.showErrorMessage(
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
    file: path.basename(actualFileName),
    refactor: "Rename Variable",
    before,
    after,
    delta,
    energy,
    commit: { message: finalReason },
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

  return { preview, renamed: `${oldName} -> ${chosenName}` };
}

/* ---------------- Helper functions ---------------- */

function extractJsonArray(output: string, label: string): string[] {
  const match = output.match(new RegExp(`${label}:\\s*(\\[[^\\]]*\\])`));
  if (!match) return [];
  try {
    const arr = JSON.parse(match[1]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

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

  if (classStart === -1) {
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const trimmed = lines[i].trim();
      if (/^(public|private|protected)?\s*class\s+\w+/.test(trimmed)) {
        classStart = i;
        break;
      }
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

function extractFullLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`, "i");
  const match = output.match(re);
  return match ? match[1].trim() : "";
}

export function extractReason(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim() : "";
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
