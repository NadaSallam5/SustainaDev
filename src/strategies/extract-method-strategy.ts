import {
  RefactorStrategy,
  BaseRefactorInput,
  RefactorResult,
} from "../core/refactor-strategy";
import {
  extractSection,
  extractLabelValue,
  extractClassBlock,
} from "../core/utils";

export class ExtractMethodStrategy implements RefactorStrategy {
  name = "extract-method";

  buildPrompt(input: BaseRefactorInput): string {
    const { fullCode, fileName, range, context } = input;

    const adjustedFrom = Math.max(0, range.from - 1);
    const adjustedTo = range.to;

    // Use adjustedFrom for extractClassBlock and prompt
    const { classBlock } = extractClassBlock(fullCode, adjustedFrom);

    return `
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
    File: ${fileName ?? "UnknownFile.java"}
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
  }

  parseResponse(response: string): RefactorResult {
    return {
      preview: extractSection(response, "Preview"),
      details: {
        newMethod: extractSection(response, "New Method"),
        callName: extractLabelValue(response, "Call Name"),
        reason: extractLabelValue(response, "Reason"),
      },
    };
  }
}
