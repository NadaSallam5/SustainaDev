import * as vscode from "vscode";
import { MethodFacts } from "../types";

// ============================================================
//  MiniSkeleton — the token-efficient LLM payload
// ============================================================

/**
 * A surgical extract of a source file, containing only what the LLM
 * needs to perform algorithmic refactoring.
 *
 * Token savings: typically 60-90% vs. sending the entire class block.
 *
 * Fields are intentionally language-agnostic so that any parser backend
 * (JavaParser today, Tree-sitter tomorrow) can populate them.
 */
export interface MiniSkeleton {
  /** e.g. 'java' | 'python' | 'javascript' */
  language: string;

  /**
   * Full source text of ONLY the target method / function.
   * This is the primary payload the LLM will refactor.
   */
  targetMethod: string;

  /**
   * Field / attribute declarations at the class / module level
   * (without method bodies).
   * Allows the LLM to suggest memoization using existing state.
   * Empty string when not applicable (e.g. a top-level Python function).
   */
  classFields: string;

  /**
   * Interface / type-alias definitions that the target method references.
   * Helps the LLM understand the shape of data being manipulated.
   * Empty string when there are none.
   */
  typeDefinitions: string;

  /**
   */
  imports: string;

  /**
   * The exact AST range of the target method within the document.
   * Used for mathematically perfect string replacement.
   */
  targetMethodRange?: vscode.Range;

  /**
   * The name of the class that owns the target method (if applicable).
   * Injected into the prompt to prevent the AI from hallucinating a new class wrapper.
   */
  className?: string;

  /**
   * Individual type definitions (DTOs, interfaces, enums) split by name.
   * Used to filter only the types actually referenced in the target method,
   * rather than sending all DTOs in the file.
   */
  typeSymbolList?: Array<{ name: string; text: string; fields: string }>;
}

// ============================================================
//  ICodeAnalyzer — the stable interface every backend must implement
// ============================================================

/**
 * A language-specific code analysis backend.
 *
 * JavaParser implements this today.
 * Tree-sitter will implement it tomorrow — with ZERO changes needed
 * outside of this interface and analyzerFactory.ts.
 *
 * Contract rules:
 *  - analyzeFile()    → returns MethodFacts[] (one per method in the file)
 *  - extractSkeleton() → returns a MiniSkeleton for a single named method
 */
export interface ICodeAnalyzer {
  /**
   * Analyze the currently active file and return facts for every method.
   * Must be equivalent in output to the existing runJavaAnalyzer() shape.
   */
  analyzeFile(
    context: vscode.ExtensionContext
  ): Promise<MethodFacts[]>;

  /**
   * Extract a MiniSkeleton from the full file source for the named method.
   * This is the surgical extract sent to the LLM instead of the full class.
   *
   * @param fullCode    Full text of the source file
   * @param methodName  Name of the target method to focus on
   */
  extractSkeleton(
    document: vscode.TextDocument,
    methodName: string
  ): Promise<MiniSkeleton>;
}

// ============================================================
//  Error type for unsupported languages
// ============================================================

/**
 * Thrown by analyzerFactory when no ICodeAnalyzer is registered
 * for the active document's language.
 */
export class UnsupportedLanguageError extends Error {
  constructor(public readonly languageId: string) {
    super(
      `SustainaDev: Language "${languageId}" is not yet supported. ` +
        `Java is fully supported. Python and JavaScript support is coming soon.`
    );
    this.name = "UnsupportedLanguageError";
  }
}
