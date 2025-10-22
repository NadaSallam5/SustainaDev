import OpenAI from "openai";
import * as vscode from "vscode";

const client = new OpenAI({
  apiKey:
    "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",
  project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
});

export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string
): Promise<{ preview: string; newMethod: string; callName: string }> {
  const { classBlock } = extractClassBlock(fullCode, range.from);

  const prompt = `
You are a senior Java refactoring engineer.

Perform an **Extract Method** refactoring within the following Java class.

### Requirements
- Modify ONLY code inside this class.
- Keep imports, outer braces, and all existing methods untouched.
- Insert exactly **one** new private method directly after the existing one.
- Maintain correct braces and indentation (4 spaces per level).
- Replace the selected lines with a call to the new method at the same location.
- If variables from outside the extracted lines are used, pass them as parameters.
- If a value is needed later, return it from the new method.
- Do NOT duplicate the new method or create multiple versions.
- Do NOT move or rename any other code.
- The result must be valid, compilable Java code.

### Input
File: ${fileName ?? "UnknownFile.java"}
Extract lines: ${range.from}–${range.to}

### Full class:
\`\`\`java
${classBlock}
\`\`\`

### Output Format (strict)
---
Preview:
\`\`\`java
(full updated class with ONE new method inserted)
\`\`\`
New Method:
\`\`\`java
(only the new method)
\`\`\`
Call Name:
(newMethodNameOnly)
---
`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1, // more deterministic
    max_tokens: 3000, // prevent truncation
  });

  const text = resp.choices?.[0]?.message?.content ?? "";

  const preview = extractSection(text, "Preview");
  const newMethod = extractSection(text, "New Method");
  const callName = extractLabelValue(text, "Call Name");

  if (!preview || !newMethod || !callName) {
    vscode.window.showErrorMessage("AI output missing sections.");
    throw new Error("Incomplete AI response");
  }

  if (!isBalanced(preview)) {
    vscode.window.showWarningMessage(
      "⚠️ AI output braces unbalanced — review before applying."
    );
  }

  return { preview, newMethod, callName };
}

/* ---------------- Helper functions ---------------- */

function extractClassBlock(fullCode: string, functionStart: number) {
  const lines = fullCode.split(/\r?\n/);
  let classStart = 0;
  let classEnd = lines.length - 1;

  for (let i = functionStart - 1; i >= 0; i--) {
    if (lines[i].includes("class ")) {
      classStart = i;
      break;
    }
  }

  let braceCount = 0;
  for (let i = classStart; i < lines.length; i++) {
    const line = lines[i];
    braceCount += (line.match(/{/g) || []).length;
    braceCount -= (line.match(/}/g) || []).length;
    if (braceCount === 0 && i > classStart) {
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
