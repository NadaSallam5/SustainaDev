import OpenAI from "openai";
import * as vscode from "vscode";

const client = new OpenAI({
  apiKey:
    "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",
  project: "proj_LNUP8IUIyX6NsPPmk5Fg5e37",
});

/**
 * Builds an Extract Method patch using the OpenAI API.
 * Returns { preview, newMethod, callName }
 */
export async function buildExtractPatch(
  fullCode: string,
  range: { from: number; to: number },
  fileName?: string
): Promise<{ preview: string; newMethod: string; callName: string }> {
  const lines = fullCode.split(/\r?\n/);
  const snippet = lines.slice(range.from - 1, range.to).join("\n");

  const prompt = `
You are an expert Java refactoring assistant.
Perform an **Extract Method** refactoring on the given code.

### Rules:
- Keep class and import structure intact.
- Do NOT change program behavior.
- Do NOT rename or modify existing code outside the extracted block.
- Replace the selected lines with a call to the new method.
- Use a clean, descriptive name for the new method (camelCase, like 'extractedHelper').
- Maintain indentation.
- Return code in the requested format below.

### Input:
File: ${fileName ?? "UnknownFile.java"}
Extract lines: ${range.from}–${range.to}

### Full code:
\`\`\`java
${fullCode}
\`\`\`

### Output Format (strict):
---
Preview:
\`\`\`java
(full file content with extracted method call inserted and new method appended)
\`\`\`
New Method:
\`\`\`java
(only the new method)
\`\`\`
Call Name:
(newMethodNameOnly)
---
`;

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const text = resp.choices?.[0]?.message?.content ?? "";

    const preview = extractSection(text, "Preview");
    const newMethod = extractSection(text, "New Method");
    const callName = extractLabelValue(text, "Call Name");

    if (!preview || !newMethod || !callName) {
      throw new Error("AI output missing one or more required fields.");
    }

    return { preview, newMethod, callName };
  } catch (err: any) {
    vscode.window.showErrorMessage("AI Extract Method failed: " + err.message);
    throw err;
  }
}

/* ------------------------- Helpers ------------------------- */

// Extract a ```java ... ``` block from labeled sections
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

// Extract single-line label (for Call Name)
function extractLabelValue(output: string, label: string): string {
  const re = new RegExp(`${label}:\\s*(.*)`);
  const match = output.match(re);
  return match ? match[1].trim().split(/\s+/)[0] : "";
}
