import { ICodeAnalyzer, UnsupportedLanguageError } from "./analyzerTypes";
import { JavaParserAnalyzer } from "./javaParserAnalyzer";
import { UniversalLspAnalyzer } from "./universalLspAnalyzer";

// ============================================================
//  analyzerFactory
//
//  The ONLY file that needs to be edited when Tree-sitter lands.
//  Your friend adds new cases to getAnalyzer() — nothing else changes.
//
//  HOW TO ADD A NEW LANGUAGE (Tree-sitter integration guide):
//  ----------------------------------------------------------
//  1. Create `src/business/analyzer/treeSitterAnalyzer.ts`
//     implementing ICodeAnalyzer.
//  2. Import it here.
//  3. Add:  case 'python':
//           case 'javascript':
//             return new TreeSitterAnalyzer(languageId);
//  That's it. Zero other files change.
// ============================================================

/**
 * Returns the correct ICodeAnalyzer for the given VS Code language ID.
 *
 * @param languageId  vscode.TextDocument.languageId
 *                    e.g. 'java', 'python', 'javascript'
 * @throws UnsupportedLanguageError when no analyzer is registered
 *         for the given language. The caller should catch this and
 *         show a user-friendly VS Code information message.
 */
export function getAnalyzer(languageId: string): ICodeAnalyzer {
  switch (languageId) {
    case "java":
      return new JavaParserAnalyzer();


    // ── Future LSP integrations ──────────────────────────────────
    case "python":
    case "javascript":
    case "typescript":
       return new UniversalLspAnalyzer();
    // ─────────────────────────────────────────────────────────────────────

    default:
      throw new UnsupportedLanguageError(languageId);
  }
}

/**
 * Returns true if SustainaDev currently supports the given language.
 * Use this for early-exit guards without throwing.
 */
export function isLanguageSupported(languageId: string): boolean {
  const supported = new Set(["java", "python", "javascript", "typescript"]);
  return supported.has(languageId);
}
