export interface BaseRefactorInput {
  fullCode: string;
  fileName: string;
  range: { from: number; to: number };
  [key: string]: any;
}
export interface RenameVariableInput extends BaseRefactorInput {
  oldName: string;
  newName: string;
}

export interface RefactorResult {
  preview: string;
  details: Record<string, string>;
}

/**
 * Strategy Interface
 * Each refactor type (Extract, Rename, etc.)
 * must implement these methods.
 */
export interface RefactorStrategy {
  name: string;
  buildPrompt(input: BaseRefactorInput): string;
  parseResponse(response: string): RefactorResult;
}
