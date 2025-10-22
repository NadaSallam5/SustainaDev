import OpenAI from "openai";
import * as vscode from "vscode";

const client = new OpenAI({
  apiKey:
    "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",
  project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
});
/**
 * Ask OpenAI to perform an Extract Method refactoring.
 * Returns { preview, newMethod, callName }.
 */
export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string
): Promise<{ preview: string; newMethod: string; callName: string }> {
  // 1️⃣ Extract only the class that contains the target method
  const { classBlock } = extractClassBlock(fullCode, range.from);

  // 2️⃣ Construct a strict, scope-bounded prompt
  const prompt = `
You are a senior Java refactoring engineer.

Perform an **Extract Method** refactoring inside the following class.

### Requirements
- Modify code ONLY inside this class.
- Keep imports, outer braces, and other classes untouched.
- Insert the new method directly below the original method.
- Maintain indentation (4 spaces per level).
- Replace the selected lines with a call to the new method.
- If the extracted block uses variables declared before it, pass them as parameters.
- If the extracted block produces a value used later, return it from the new method.
- Do NOT add or remove braces anywhere else.
- The new method must be private and in camelCase (e.g., calculateAverage).

### Input
File: ${fileName ?? "UnknownFile.java"}
Extract lines: ${range.from}–${range.to}

### Full class:
\`\`\`java
${classBlock}
\`\`\`

### Output format (strict)
---
Preview:
\`\`\`java
(full updated class with the new method inserted)
\`\`\`
New Method:
\`\`\`java
(only the new method)
\`\`\`
Call Name:
(newMethodNameOnly)
---
`;

  // 4️⃣ Call OpenAI
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.2,
    max_tokens: 800,
  });

  const text = resp.choices?.[0]?.message?.content ?? "";

  // 5️⃣ Parse the three required sections
  const preview = extractSection(text, "Preview");
  const newMethod = extractSection(text, "New Method");
  const callName = extractLabelValue(text, "Call Name");

  if (!preview || !newMethod || !callName) {
    vscode.window.showErrorMessage(
      "AI output missing one or more required sections."
    );
    throw new Error("Incomplete AI response");
  }

  return { preview, newMethod, callName };
}

/* --------------------------------------------------------------------- */
/* ---------------------------- Helper Functions ----------------------- */
/* --------------------------------------------------------------------- */

/**
 * Find the class block surrounding the given line.
 */
function extractClassBlock(
  fullCode: string,
  functionStart: number
): { classBlock: string; classStart: number; classEnd: number } {
  const lines = fullCode.split(/\r?\n/);
  let classStart = 0;
  let classEnd = lines.length - 1;

  // find nearest "class " line above
  for (let i = functionStart - 1; i >= 0; i--) {
    if (lines[i].includes("class ")) {
      classStart = i;
      break;
    }
  }

  // count braces until class closes
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

/** Extract ```java ...``` blocks for Preview/New Method sections. */
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

/** Extract simple single-line label (for Call Name). */
function extractLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim().split(/\s+/)[0] : "";
}

/** Quick brace-balance sanity check. */
function isBalanced(code: string): boolean {
  let count = 0;
  for (const ch of code) {
    if (ch === "{") count++;
    else if (ch === "}") count--;
    if (count < 0) return false;
  }
  return count === 0;
}
