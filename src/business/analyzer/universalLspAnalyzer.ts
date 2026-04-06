import * as vscode from 'vscode';
import { ICodeAnalyzer, MiniSkeleton } from './analyzerTypes';
import { MethodFacts } from '../types';

export class UniversalLspAnalyzer implements ICodeAnalyzer {
  
  async extractSkeleton(document: vscode.TextDocument, methodName: string): Promise<MiniSkeleton> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols) {
      throw new Error("No language server active for this file type.");
    }

    let targetMethodSymbol: vscode.DocumentSymbol | undefined;
    let classSymbol: vscode.DocumentSymbol | undefined;

    // 1. Traverse the symbol tree to find the Target Method and its parent Class
    const findTarget = (syms: vscode.DocumentSymbol[], parent?: vscode.DocumentSymbol) => {
      for (const sym of syms) {
        if (sym.name.includes(methodName) && 
           (sym.kind === vscode.SymbolKind.Method || sym.kind === vscode.SymbolKind.Function)) {
          targetMethodSymbol = sym;
          classSymbol = parent;
          return;
        }
        if (sym.children) {
          findTarget(sym.children, sym);
        }
      }
    };
    findTarget(symbols);

    if (!targetMethodSymbol) {
      throw new Error(`Method ${methodName} not found by LSP.`);
    }

    // 2. Extract EXACT target method text using the LSP Range
    const targetMethodText = document.getText(targetMethodSymbol.range);

    // 3. Extract Class Fields (Only fields, no other methods)
    let classFieldsText = "";
    if (classSymbol && classSymbol.children) {
      const fields = classSymbol.children.filter(
        c => c.kind === vscode.SymbolKind.Field || c.kind === vscode.SymbolKind.Property
      );
      classFieldsText = fields.map(f => document.getText(f.range)).join('\n');
    }

    // 4. Extract Type Definitions (DTOs, Interfaces, Enums, Structs) for AI context!
    // TODO: Currently, executeDocumentSymbolProvider ONLY scans the active text document.
    // If DTOs live in external files (e.g. `WarehouseStock.java` in another folder), they are missed.
    // FUTURE ROADMAP: To support cross-file DTO extraction:
    // 1. Scan target method parameters natively to find custom types.
    // 2. Fire `vscode.commands.executeCommand("vscode.executeDefinitionProvider")` on those types.
    // 3. Open the returned external URIs in the background and pull their class definitions.
    const extractTypes = (syms: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] => {
      let found: vscode.DocumentSymbol[] = [];
      for (const sym of syms) {
        const isTypeDecl = sym.kind === vscode.SymbolKind.Class || 
                           sym.kind === vscode.SymbolKind.Interface || 
                           sym.kind === vscode.SymbolKind.Struct || 
                           sym.kind === vscode.SymbolKind.Enum;
        
        if (isTypeDecl) {
          // If this is the main class wrapping our method, DO NOT capture it entirely!
          // We only want its nested children (Inner Classes/DTOs).
          if (classSymbol && sym.name === classSymbol.name) {
            if (sym.children) found = found.concat(extractTypes(sym.children));
          } else {
            // It's a distinct DTO, interface, or struct!
            found.push(sym);
          }
        } 
        // Recurse into namespaces/modules to find root-level types (C#/TypeScript)
        else if (sym.kind === vscode.SymbolKind.Namespace || sym.kind === vscode.SymbolKind.Module) {
          if (sym.children) found = found.concat(extractTypes(sym.children));
        }
      }
      return found;
    };

    const typeSymbols = extractTypes(symbols);
    const typeDefinitionsText = typeSymbols.map(t => document.getText(t.range)).join('\n\n');

    // 5. Extract Imports (Heuristic: grab everything before the first major symbol)
    const firstSymbolLine = symbols[0]?.range.start.line || 0;
    const importsRange = new vscode.Range(0, 0, Math.max(0, firstSymbolLine - 1), document.lineAt(Math.max(0, firstSymbolLine - 1)).text.length);
    const importsText = document.getText(importsRange).trim();

    return {
      language: document.languageId,
      targetMethod: targetMethodText,
      classFields: classFieldsText,
      typeDefinitions: typeDefinitionsText,
      imports: importsText,
      targetMethodRange: targetMethodSymbol.range,
      className: classSymbol?.name,
      typeSymbolList: typeSymbols.map(t => {
        const fieldSymbols = (t.children ?? []).filter(
          c => c.kind === vscode.SymbolKind.Field || c.kind === vscode.SymbolKind.Property
        );
        const fields = fieldSymbols.map(f => document.getText(f.range).trim()).join(', ');
        return { name: t.name, text: document.getText(t.range), fields };
      }),
    };
  }


  // Fallback for analysis - we continue to let the Java parser or TS parser handle complexity
  async analyzeFile(context: vscode.ExtensionContext): Promise<MethodFacts[]> {
    throw new Error("UniversalLspAnalyzer does not implement analyzeFile. Use a dedicated language parser.");
  }
}
