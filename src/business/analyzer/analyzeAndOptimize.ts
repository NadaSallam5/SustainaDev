import { chooseRefactor } from "../refactor/chooseRefactor";
import { buildOptimizationPatch } from "../refactor/optimizeComplexity";

import { runJavaAnalyzer } from "./javaRunner";
import * as vscode from "vscode";

import { buildOptimizationReport } from "../complexity/report";

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

  // ✅ Output channel
  const output = vscode.window.createOutputChannel("SustainaDev");
  output.show(true);
  output.appendLine("SustainaDev OutputChannel created ✅");
  output.appendLine(`Triggered at: ${new Date().toISOString()}`);

  // Analyze currently opened file
  const targetFile = editor.document.uri.fsPath;
  output.appendLine(`Active file: ${targetFile}`);

  // ✅ ALWAYS use the real current editor text (not incoming `code`)
  const documentText = editor.document.getText();

  // ---------- 1) Run analyzer BEFORE ----------
  output.appendLine("Running Java analyzer (BEFORE)...");
  const factsList = await runJavaAnalyzer(context);

  if (!factsList || factsList.length === 0) {
    output.appendLine("ERROR: No MethodFacts received from Java analyzer (BEFORE).");
    throw new Error("No MethodFacts received from Java analyzer");
  }
  output.appendLine(`Analyzer BEFORE returned ${factsList.length} methods.`);

  // ---------- 2) Detect method at cursor ----------
  const cursorOffset = editor.document.offsetAt(editor.selection.active) ?? 0;
  const beforeCursor = documentText.slice(0, cursorOffset);

  const methodMatch = beforeCursor.match(/(\w+)\s*\([^)]*\)\s*\{/g);
  const targetMethodName = methodMatch
    ? methodMatch[methodMatch.length - 1].match(/(\w+)\s*\(/)?.[1]
    : null;

  if (!targetMethodName) {
    output.appendLine("ERROR: Could not detect method at cursor position.");
    vscode.window.showErrorMessage("Could not detect the method at cursor position.");
    return;
  }

  output.appendLine(`Detected target method: ${targetMethodName}`);

  // ---------- 3) Pick BEFORE facts ----------
  const beforeFacts = factsList.find((f) => f.methodName === targetMethodName);

  if (!beforeFacts) {
    output.appendLine(`ERROR: No BEFORE facts found for method: ${targetMethodName}`);
    vscode.window.showErrorMessage(`No analysis facts found for method ${targetMethodName}`);
    return;
  }

  output.appendLine(
    `BEFORE facts: loopDepth=${beforeFacts.maxLoopDepth}, cyclomatic=${beforeFacts.cyclomaticComplexity}, callsSelf=${beforeFacts.callsSelf}`
  );

  // ✅✅✅ DEBUG (IMPORTANT): print full facts object + string concat flag
  output.appendLine("=== DEBUG BEFORE FACTS JSON ===");
  output.appendLine(JSON.stringify(beforeFacts, null, 2));
  output.appendLine(
    `DEBUG hasStringConcatInLoop=${(beforeFacts as any).hasStringConcatInLoop} | maxLoopDepth=${beforeFacts.maxLoopDepth} | callsSelf=${beforeFacts.callsSelf}`
  );

  // ---------- 4) Decide optimization ----------
  const decision = chooseRefactor(beforeFacts);
  output.appendLine(`Refactor decision: ${decision.type}`);

  // ---------- 5) Generate patch + show preview (NO APPLY YET) ----------
  output.appendLine("Generating optimization preview...");
  let patch: { preview: string; reason: string };

  try {
    patch = await buildOptimizationPatch(documentText, range, targetFile, {
      targetMethodName: beforeFacts.methodName,
      smellType: decision.type,
      methodFacts: beforeFacts,
    });

    // ✅ DEBUG patch meta
    output.appendLine("=== DEBUG PATCH META ===");
    output.appendLine(`Patch reason: ${patch?.reason ?? "no-reason"}`);
    output.appendLine(`Patch preview length: ${patch?.preview?.length ?? 0}`);
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

  // If no real change
  if (!patch?.preview || patch.preview.trim() === documentText.trim()) {
    output.appendLine("ℹ️ No optimization changes were generated.");
    vscode.window.showInformationMessage("ℹ️ No optimization changes were generated.");
    return;
  }

  // ---------- 6) Ask Accept/Reject ----------
  const choice = await vscode.window.showQuickPick(
    ["✅ Accept Optimization", "❌ Reject"],
    { placeHolder: "Apply the optimized code?" }
  );

  if (choice !== "✅ Accept Optimization") {
    output.appendLine("User rejected optimization ❌");
    vscode.window.showInformationMessage("Optimization rejected.");
    return;
  }

  // ---------- 7) APPLY optimized code to the real file ----------
  output.appendLine("Applying optimization patch (user accepted)...");
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(editor.document.getText().length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, fullRange, patch.preview);
  await vscode.workspace.applyEdit(edit);
  await editor.document.save();
  output.appendLine("Optimization patch applied and document saved ✅");

  // ---------- 8) Run analyzer AFTER ----------
  output.appendLine("Running Java analyzer (AFTER)...");
  const afterFactsList = await runJavaAnalyzer(context);

  if (!afterFactsList || afterFactsList.length === 0) {
    output.appendLine("ERROR: No MethodFacts received from Java analyzer (AFTER).");
    vscode.window.showErrorMessage("No MethodFacts received after optimization.");
    return;
  }
  output.appendLine(`Analyzer AFTER returned ${afterFactsList.length} methods.`);

  // ---------- 9) Pick AFTER facts ----------
  const afterFacts = afterFactsList.find((f) => f.methodName === targetMethodName);

  if (!afterFacts) {
    output.appendLine(`ERROR: No AFTER facts found for method: ${targetMethodName}`);
    vscode.window.showErrorMessage(`No AFTER analysis facts found for method ${targetMethodName}`);
    return;
  }

  output.appendLine(
    `AFTER facts: loopDepth=${afterFacts.maxLoopDepth}, cyclomatic=${afterFacts.cyclomaticComplexity}, callsSelf=${afterFacts.callsSelf}`
  );

  // ---------- 10) Build report ----------
  const report = buildOptimizationReport(beforeFacts, afterFacts);

  // ---------- 11) Show report ----------
  output.appendLine("=== Complexity Report (Before vs After) ===");
  output.appendLine(`Before: ${report.before}`);
  output.appendLine(`After:  ${report.after}`);
  output.appendLine(`Improvement: ${report.improvement}`);

  vscode.window.showInformationMessage(
    `Complexity improved: ${report.before} → ${report.after}`
  );

  output.appendLine("Done ✅");
}
