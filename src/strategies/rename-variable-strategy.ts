import {
  RefactorStrategy,
  RenameVariableInput,
  RefactorResult,
} from "../core/refactor-strategy";
import {
  extractSection,
  extractLabelValue,
  extractClassBlock,
} from "../core/utils";

export class RenameVariableStrategy implements RefactorStrategy {
  name = "rename-variable";

  buildPrompt(input: RenameVariableInput): string {
    const { fullCode, fileName, oldName, newName, range } = input;

    // Adjusted range, although it may not be needed for variable renaming
    const adjustedFrom = Math.max(0, range.from - 1);
    const adjustedTo = range.to;

    // Use adjustedFrom for extractClassBlock and prompt
    const { classBlock } = extractClassBlock(fullCode, adjustedFrom);

    return `
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
  }

  parseResponse(response: string): RefactorResult {
    return {
      preview: extractSection(response, "Preview"),
      details: {
        renamedVariable: extractLabelValue(response, "Renamed Variable"),
        reason: extractLabelValue(response, "Reason"),
      },
    };
  }
}
