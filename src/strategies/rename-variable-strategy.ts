import {
  RefactorStrategy,
  BaseRefactorInput,
  RefactorResult,
} from "../core/refactor-strategy";
import { extractSection, extractLabelValue } from "../core/utils";

interface RenameVariableInput extends BaseRefactorInput {
  oldName: string;
  newName: string;
}

export class RenameVariableStrategy implements RefactorStrategy {
  name = "rename-variable";

  buildPrompt(input: RenameVariableInput): string {
    const { fullCode, fileName, oldName, newName } = input;

    return `
You are a Java refactoring expert performing a **Rename Variable** operation.

### Task
Rename variable \`${oldName}\` to \`${newName}\` safely throughout the class.

### Input
File: ${fileName ?? "Unknown.java"}
\`\`\`java
${fullCode}
\`\`\`

### Output Format
Preview:
\`\`\`java
(full updated class)
\`\`\`
Renamed Variable:
${oldName} -> ${newName}
Reason:
(one sentence)
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
