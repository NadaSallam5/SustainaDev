import OpenAI from "openai";
import * as vscode from "vscode";

const client = new OpenAI({
  apiKey:
    "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",
  project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
});

/**
 * Build an Extract Method patch using OpenAI.
 * Returns: { preview, newMethod, callName }
 */
export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string
): Promise<{ preview: string; newMethod: string; callName: string }> {
  // 1️⃣ Extract class block around the selected function
  const { classBlock } = extractClassBlock(fullCode, range.from);

  // 2️⃣ Build strict, scope-bounded prompt
  const prompt = `
You are an expert Java refactoring assistant.

Perform ONLY an **Extract Method** refactoring inside the following class.

### Rules:
- Modify code ONLY inside this class.
- Keep imports, outer braces, and other classes unchanged.
- Insert the new method directly below the original one.
- Maintain indentation and syntax.
- Replace the selected lines with a call to the new method.
- Do NOT add extra closing braces.
- Use camelCase for the new method name (e.g. extractedHelper).
- Do NOT change any other code or rename existing methods.

### Input
File: ${fileName ?? "UnknownFile.java"}
Lines to extract: ${range.from}–${range.to}

### Full class:
\`\`\`java
${classBlock}
\`\`\`

### Output Format (strict)
---
Preview:
\`\`\`java
(full updated class with method call inserted and new method appended)
\`\`\`
New Method:
\`\`\`java
(only the new method code)
\`\`\`
Call Name:
(newMethodNameOnly)
---
`;

  // 3️⃣ Send to OpenAI
  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 2800,
  });

  const text = resp.choices?.[0]?.message?.content ?? "";

  // 4️⃣ Parse AI response sections
  const preview = extractSection(text, "Preview");
  const newMethod = extractSection(text, "New Method");
  const callName = extractLabelValue(text, "Call Name");

  if (!preview || !newMethod || !callName) {
    vscode.window.showErrorMessage("AI output missing required sections.");
    throw new Error("Incomplete AI response");
  }

  // 5️⃣ Simple safety correction
  if (!preview.includes(callName)) {
    vscode.window.showWarningMessage(
      "⚠️ AI output missing call reference, inserting fallback name."
    );
  }

  return { preview, newMethod, callName };
}

/* --------------------------------------------------------------------- */
/* ---------------------------- Helper Functions ----------------------- */
/* --------------------------------------------------------------------- */

/**
 * Finds the class block surrounding the given line number.
 */
function extractClassBlock(
  fullCode: string,
  functionStart: number
): { classBlock: string; classStart: number; classEnd: number } {
  const lines = fullCode.split(/\r?\n/);
  let classStart = 0;
  let classEnd = lines.length - 1;

  // find nearest "class " line before the function start
  for (let i = functionStart - 1; i >= 0; i--) {
    if (lines[i].includes("class ")) {
      classStart = i;
      break;
    }
  }

  // find closing brace of that class
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

/** Extract triple-backtick code blocks from AI output */
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

/** Extract simple single-line label (Call Name) */
function extractLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim().split(/\s+/)[0] : "";
}
