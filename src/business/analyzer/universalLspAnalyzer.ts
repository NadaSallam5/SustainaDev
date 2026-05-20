import * as vscode from "vscode";
import { ICodeAnalyzer, MiniSkeleton } from "./analyzerTypes";
import { MethodFacts } from "../types";
import { parseCode } from "../parser/astParser";
import { extractFeatures } from "./featureExtractor";

export class UniversalLspAnalyzer implements ICodeAnalyzer {
  // ─── analyzeFile ────────────────────────────────────────────────────────────
  async analyzeFile(context: vscode.ExtensionContext): Promise<MethodFacts[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("No active editor.");
    }

    const document = editor.document;

   const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
  "vscode.executeDocumentSymbolProvider",
  document.uri
);
    if (!symbols || symbols.length === 0) {
      throw new Error(
        "No symbols found by LSP. Make sure a language server is active.",
      );
    }

    const methodSymbols: vscode.DocumentSymbol[] = [];

    const collectMethods = (syms: vscode.DocumentSymbol[]) => {
      for (const sym of syms) {
        if (
          sym.kind === vscode.SymbolKind.Method ||
          sym.kind === vscode.SymbolKind.Function
        ) {
          methodSymbols.push(sym);
        }
        if (sym.children) {
          collectMethods(sym.children);
        }
      }
    };
    collectMethods(symbols);

    if (methodSymbols.length === 0) {
      throw new Error("No methods found in file.");
    }

    const filePath = document.uri.fsPath;
    const fileExt = filePath.split(".").pop()?.toLowerCase() ?? "java";

    const factsList: MethodFacts[] = [];

    for (const sym of methodSymbols) {
      const methodName = sym.name.replace(/\(.*\)/, "").trim();
      const methodText = document.getText(sym.range);

      let wrappedCode: string;
      if (fileExt === "java") {
        wrappedCode = `class __Wrapper__ {\n${methodText}\n}`;
      } else if (fileExt === "py") {
        wrappedCode = methodText;
      } else {
        wrappedCode =
          sym.kind === vscode.SymbolKind.Method
            ? `class __Wrapper__ {\n${methodText}\n}`
            : methodText;
      }

      const methodTree = parseCode(wrappedCode, filePath);
      const features = extractFeatures(methodTree.rootNode, methodName);
// Count how many List parameters the method has
const listParamCount = (methodText.match(/List</g) || []).length;

      factsList.push({
        methodName,
        callsSelf: features.recursion,
        isLinearRecursion: features.recursiveCallCount === 1,
        hasOverlappingSubproblems: features.recursiveCallCount > 1,
        maxLoopDepth: features.loopDepth,
        cyclomaticComplexity: 1,
        isPureAccumulation: false,
        hasStringConcatInLoop: features.stringConcatInLoop,
        hasSortingCall: features.sortingCalls > 0,
        sortInsideLoop: features.sortingInsideLoop,
        hasNestedLoop: features.hasNestedLoop,
        hasHashMapLookup: features.hasHashMapLookup,
        usesStringBuilder: features.usesStringBuilder, 
        listParamCount, // ✅ NEW
      });

      await new Promise((r) => setTimeout(r, 0));
    }

    return factsList;
  }

  // ─── extractSkeleton ────────────────────────────────────────────────────────
  async extractSkeleton(
    document: vscode.TextDocument,
    methodName: string,
  ): Promise<MiniSkeleton> {
    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[]
    >("vscode.executeDocumentSymbolProvider", document.uri);

    if (!symbols) {
      throw new Error("No language server active for this file type.");
    }

    let targetMethodSymbol: vscode.DocumentSymbol | undefined;
    let classSymbol: vscode.DocumentSymbol | undefined;

    const findTarget = (
      syms: vscode.DocumentSymbol[],
      parent?: vscode.DocumentSymbol,
    ) => {
      for (const sym of syms) {
        const symBaseName = sym.name.replace(/\(.*\)/, "").trim();
        if (
          symBaseName === methodName &&
          (sym.kind === vscode.SymbolKind.Method ||
            sym.kind === vscode.SymbolKind.Function ||
            sym.kind === vscode.SymbolKind.Constructor)
        ) {
          targetMethodSymbol = sym;
          classSymbol = parent;
          return;
        }
        if (sym.children) {
          findTarget(sym.children, sym);
        }
      }
    };

    if (symbols) {
      findTarget(symbols);
    }

    if (!targetMethodSymbol) {
      throw new Error(`Method ${methodName} not found by LSP.`);
    }

    const targetMethodText = document.getText(targetMethodSymbol.range);

    let classFieldsText = "";
    if (classSymbol && classSymbol.children) {
      const fields = classSymbol.children.filter(
        (c) =>
          c.kind === vscode.SymbolKind.Field ||
          c.kind === vscode.SymbolKind.Property,
      );
      classFieldsText = fields.map((f) => document.getText(f.range)).join("\n");
    }

    const extractTypes = (
      syms: vscode.DocumentSymbol[],
    ): vscode.DocumentSymbol[] => {
      let found: vscode.DocumentSymbol[] = [];
      for (const sym of syms) {
        const isTypeDecl =
          sym.kind === vscode.SymbolKind.Class ||
          sym.kind === vscode.SymbolKind.Interface ||
          sym.kind === vscode.SymbolKind.Struct ||
          sym.kind === vscode.SymbolKind.Enum;

        if (isTypeDecl) {
          if (classSymbol && sym.name === classSymbol.name) {
            if (sym.children) found = found.concat(extractTypes(sym.children));
          } else {
            found.push(sym);
          }
        } else if (
          sym.kind === vscode.SymbolKind.Namespace ||
          sym.kind === vscode.SymbolKind.Module
        ) {
          if (sym.children) found = found.concat(extractTypes(sym.children));
        }
      }
      return found;
    };

    const typeSymbols = extractTypes(symbols);
    const typeDefinitionsText = typeSymbols
      .map((t) => document.getText(t.range))
      .join("\n\n");

    const firstSymbolLine = symbols[0]?.range.start.line || 0;
    const importsRange = new vscode.Range(
      0,
      0,
      Math.max(0, firstSymbolLine - 1),
      document.lineAt(Math.max(0, firstSymbolLine - 1)).text.length,
    );
    const importsText = document.getText(importsRange).trim();

    return {
      language: document.languageId,
      targetMethod: targetMethodText,
      classFields: classFieldsText,
      typeDefinitions: typeDefinitionsText,
      imports: importsText,
      targetMethodRange: targetMethodSymbol.range,
      className: classSymbol?.name,
      typeSymbolList: typeSymbols.map((t) => {
        const fieldSymbols = (t.children ?? []).filter(
          (c) =>
            c.kind === vscode.SymbolKind.Field ||
            c.kind === vscode.SymbolKind.Property,
        );
        const fields = fieldSymbols
          .map((f) => document.getText(f.range).trim())
          .join(", ");
        return { name: t.name, text: document.getText(t.range), fields };
      }),
    };
  }
}