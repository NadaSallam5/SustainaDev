import { chooseRefactor } from "../refactor/chooseRefactor";
import {
  buildOptimizationPatch,
  logOptimizationFromReport,
} from "../refactor/optimizeComplexity";
import { estimateComplexityWithQwen } from "../complexity/qwenComplexity";
import { buildOptimizationReport } from "../complexity/report";
import { AIComplexityResult } from "../complexity/types";
import { runJavaAnalyzer } from "./javaRunner";
import * as vscode from "vscode";


export async function analyzeAndOptimize(
  context: vscode.ExtensionContext,
  code: string,
  filePath: string,
  range: { from: number; to: number }
) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    throw new Error("No active editor");
  }

  const output = vscode.window.createOutputChannel("SustainaDev");
  output.show(true);
 

  const targetFile = editor.document.uri.fsPath;


  const documentText = editor.document.getText();

  // ---------- 1) Run analyzer BEFORE ----------
 
  const factsList = await runJavaAnalyzer(context);

  if (!factsList || factsList.length === 0) {
    output.appendLine("ERROR: No MethodFacts received from Java analyzer (BEFORE).");
    throw new Error("No MethodFacts received from Java analyzer");
  }
 

  // ---------- 2) Detect method at cursor ----------
  const cursorOffset = editor.document.offsetAt(editor.selection.active) ?? 0;
  const beforeCursor = documentText.slice(0, cursorOffset);

  const methodMatches = beforeCursor.match(/(\w+)\s*\([^)]*\)\s*\{/g);

  let targetMethodName: string | null = null;

  if (methodMatches) {
    for (let i = methodMatches.length - 1; i >= 0; i--) {
      const name = methodMatches[i].match(/(\w+)\s*\(/)?.[1];

      if (!name) continue;

      const invalid = ["if", "for", "while", "switch", "catch"];

      if (!invalid.includes(name)) {
        targetMethodName = name;
        break;
      }
    }
  }

  if (!targetMethodName) {
    output.appendLine("ERROR: Could not detect method at cursor position.");
    vscode.window.showErrorMessage("Could not detect the method at cursor position.");
    return;
  }



  // ---------- 3) Pick BEFORE facts ----------
  const beforeFacts = factsList.find((f) => f.methodName === targetMethodName);

  if (!beforeFacts) {
    output.appendLine(`ERROR: No BEFORE facts found for method: ${targetMethodName}`);
    vscode.window.showErrorMessage(`No analysis facts found for method ${targetMethodName}`);
    return;
  }

 



  // ---------- 4) Decide optimization ----------
  const decision = chooseRefactor(beforeFacts);


  // ---------- 5) Generate patch + show preview ----------

  let patch: { preview: string; reason: string };

  try {
    patch = await buildOptimizationPatch(documentText, range, targetFile, {
      targetMethodName: beforeFacts.methodName,
      smellType: decision.type,
      methodFacts: beforeFacts,
    });

    
  } catch (e: any) {
    if (String(e?.message || e).includes("ALREADY_OPTIMIZED")) {
      output.appendLine("✅ Code logic is already optimized.");
      vscode.window.showInformationMessage("✅ Code logic is already optimized.");
      return;
    }

    output.appendLine(`ERROR while generating patch: ${e?.message || e}`);
    vscode.window.showErrorMessage(`Optimization failed: ${e?.message || e}`);
    return;
  }

  if (!patch?.preview || patch.preview.trim() === documentText.trim()) {
    output.appendLine("ℹ️ No optimization changes were generated.");
    vscode.window.showInformationMessage("ℹ️ No optimization changes were generated.");
    return;
  }

  // ---------- 6) Ask Accept/Reject FIRST ----------
  const choice = await vscode.window.showQuickPick(
    ["✅ Accept Optimization", "❌ Reject"],
    { placeHolder: "Apply the optimized code?" }
  );

  if (choice !== "✅ Accept Optimization") {
    output.appendLine("User rejected optimization ❌");
    vscode.window.showInformationMessage("Optimization rejected.");
    return;
  }

  // ---------- 6.5) Qwen BEFORE only after accept ----------
  let beforeAI: AIComplexityResult;

  try {
   
    beforeAI = await estimateComplexityWithQwen(documentText, beforeFacts);

  ;
  } catch (e: any) {
    output.appendLine(`QWEN BEFORE ERROR: ${e?.message || e}`);
    vscode.window.showErrorMessage(`Qwen BEFORE failed: ${e?.message || e}`);
    return;
  }

 // ---------- 7) APPLY optimized code ----------
const fullRange = new vscode.Range(
  editor.document.positionAt(0),
  editor.document.positionAt(editor.document.getText().length)
);

const edit = new vscode.WorkspaceEdit();
edit.replace(editor.document.uri, fullRange, patch.preview);
await vscode.workspace.applyEdit(edit);
await editor.document.save();

// Open the real optimized file immediately
const realDoc = await vscode.workspace.openTextDocument(editor.document.uri);
await vscode.window.showTextDocument(realDoc, {
  preview: false,
  preserveFocus: false,
});

// Close diff/preview immediately
await vscode.commands.executeCommand("workbench.action.closeOtherEditors");

// now continue the rest of the pipeline
const updatedDocumentText = realDoc.getText();
 

  // ---------- 8) Run analyzer AFTER ----------

  const afterFactsList = await runJavaAnalyzer(context);

  if (!afterFactsList || afterFactsList.length === 0) {
    output.appendLine("ERROR: No MethodFacts received from Java analyzer (AFTER).");
    vscode.window.showErrorMessage("No MethodFacts received after optimization.");
    return;
  }
 

  // ---------- 9) Pick AFTER facts ----------
  const afterFacts = afterFactsList.find((f) => f.methodName === targetMethodName);

  if (!afterFacts) {
    output.appendLine(`ERROR: No AFTER facts found for method: ${targetMethodName}`);
    vscode.window.showErrorMessage(`No AFTER analysis facts found for method ${targetMethodName}`);
    return;
  }

 
  // ---------- 9.5) Qwen AFTER ----------
  let afterAI: AIComplexityResult;

  try {

    afterAI = await estimateComplexityWithQwen(updatedDocumentText, afterFacts);


  } catch (e: any) {
    output.appendLine(`QWEN AFTER ERROR: ${e?.message || e}`);
    vscode.window.showErrorMessage(`Qwen AFTER failed: ${e?.message || e}`);
    return;
  }

 // ---------- 10) Build report from Qwen ----------
const report = buildOptimizationReport(beforeAI, afterAI, beforeFacts, afterFacts);


// ---------- 11) Show final report ----------
output.appendLine("=== Qwen Complexity Report ===");
output.appendLine(`Before: ${report.before}`);
output.appendLine(`After: ${report.after}`);
output.appendLine(`Improvement: ${report.improvement}`);
   
vscode.window.showInformationMessage(
  report.metric === "space"
    ? `Space improved: ${report.before} → ${report.after}`
    : `Complexity improved: ${report.before} → ${report.after}`
);

// ---------- 12) Save optimization log ----------
const workspace =
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

await logOptimizationFromReport(
  workspace,
  filePath,
  report,
  patch.reason
);
}