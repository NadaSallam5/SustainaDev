import * as vscode from "vscode";
import { MethodFacts } from "../types";


export interface MiniSkeleton {
  language: string;


  targetMethod: string;


  classFields: string;


  typeDefinitions: string;


  imports: string;


  targetMethodRange?: vscode.Range;


  className?: string;


  typeSymbolList?: Array<{ name: string; text: string; fields: string }>;
}


export interface ICodeAnalyzer {

  analyzeFile(
    context: vscode.ExtensionContext
  ): Promise<MethodFacts[]>;


  extractSkeleton(
    document: vscode.TextDocument,
    methodName: string
  ): Promise<MiniSkeleton>;
}


export class UnsupportedLanguageError extends Error {
  constructor(public readonly languageId: string) {
    super(
      `SustainaDev: Language "${languageId}" is not yet supported. ` +
      `Supported languages: Java, Python, JavaScript, and TypeScript.`
    );
    this.name = "UnsupportedLanguageError";
  }
}
