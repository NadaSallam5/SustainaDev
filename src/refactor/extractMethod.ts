import OpenAI from "openai";
import * as vscode from "vscode";

export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string
): Promise<{ preview: string; newMethod: string; callName: string }> {
  const client = new OpenAI({
    apiKey:
      "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",
    project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
  });

  const { classBlock } = extractClassBlock(fullCode, range.from);

  const prompt = `
You are a senior Java refactoring engineer performing an **Extract Method** refactoring.

### Task
Analyze the following Java class and identify ONE cohesive code block within the target method that should be extracted into a new private method.

### Selection Criteria (IMPORTANT)
Choose a block that is:
- **Cohesive**: Performs a single, well-defined task (e.g., printing output, validation logic, calculation)
- **Safe to extract**: Does NOT modify variables that are used later in the parent method
- **Meaningful**: At least 3-5 lines that would benefit from being a separate method
- **Pure or side-effect limited**: Prefer blocks that only read data or produce output

### What NOT to Extract
- Single lines (not worth extracting)
- Code with complex control flow that spans the entire method
- Code that would require too many parameters (>4)

### Refactoring Requirements
- Modify ONLY code inside this class
- Keep imports, outer braces, and all existing methods untouched
- Insert exactly **one** new private method 
- Maintain correct braces and indentation (4 spaces per level)
- Replace the selected lines with a call to the new method at the same location
- Pass necessary variables as parameters
- If a value is needed later, return it from the new method
- Do NOT duplicate the new method or create multiple versions
- The result must be valid, compilable Java code
- Replace the original code block with a call to this new method.
- Preserve identical functionality.


### Input
File: ${fileName ?? "UnknownFile.java"}
Target method is between lines: ${range.from}–${range.to}

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
Extracted Lines:
(start-end line numbers of what you extracted, e.g., "38-42")
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
    temperature: 0.3,
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
      `⚠️ AI output contains ${classCount} class definitions. Aborting to prevent duplication.`
    );
    throw new Error("AI output duplicated class definition.");
  }

  if (!preview || !newMethod || !callName) {
    vscode.window.showErrorMessage("AI output missing sections.");
    throw new Error("Incomplete AI response");
  }

  if (!extractedLines || extractedLines === "none") {
    vscode.window.showInformationMessage(
      "AI couldn't find a good extraction candidate in this method."
    );
    throw new Error("Ai couldn't find extraction candidate");
  }
  if (!isBalanced(preview)) {
    vscode.window.showWarningMessage(
      "⚠️ AI output braces unbalanced — review before applying."
    );
  }

  // Optional: Log what the AI decided to extract
  console.log(`AI extracted lines ${extractedLines}: ${reason}`);

  return { preview, newMethod, callName };
}

/* ---------------- Helper functions ---------------- */

function extractClassBlock(fullCode: string, functionStart: number) {
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
