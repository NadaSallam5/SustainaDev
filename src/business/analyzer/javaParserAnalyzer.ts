import * as vscode from "vscode";
import { MethodFacts } from "../types";
import { ICodeAnalyzer, MiniSkeleton } from "./analyzerTypes";
import { runJavaAnalyzer } from "./javaRunner";
import { UniversalLspAnalyzer } from "./universalLspAnalyzer";



export class JavaParserAnalyzer implements ICodeAnalyzer {

  analyzeFile(context: vscode.ExtensionContext): Promise<MethodFacts[]> {
    return runJavaAnalyzer(context);
  }

  // ----------------------------------------------------------
  //  extractSkeleton
  //  Produces a MiniSkeleton from the full file source using a
  //  lightweight TypeScript-side parse — the JAR stays untouched.
  //
  //  Strategy (Option B from the plan):
  //   1. imports  — everything before the first `class` keyword
  //   2. classFields — field declarations inside the class body
  //                    (lines that look like a field, NOT method headers)
  //   3. typeDefinitions — top-level interface/enum blocks in the file
  //   4. targetMethod — extracted by brace-counting from the method name
  // ----------------------------------------------------------
  async extractSkeleton(document: vscode.TextDocument, methodName: string): Promise<MiniSkeleton> {
    // Delegate entirely to LSP! The regex-based extraction is retired.
    const lspAnalyzer = new UniversalLspAnalyzer();
    return lspAnalyzer.extractSkeleton(document, methodName);
  }
}





