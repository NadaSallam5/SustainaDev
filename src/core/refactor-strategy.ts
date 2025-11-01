export interface BaseRefactorInput {
  fullCode: string;
  fileName: string;
  range: { from: number; to: number };
  context?: { methodBody?: string; locals?: string[] };
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
