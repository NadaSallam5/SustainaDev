import { chooseRefactor } from "../refactor/chooseRefactor";
import { buildOptimizationPatch } from "../refactor/optimizeComplexity";

import * as vscode from "vscode";
import { detectByRules } from "../refactor/ruleEngine";

// ✅ Tree-sitter
import { parseCode } from "../parser/astParser";
import { detectLanguage } from "../parser/languageDetector";
import { extractFeatures } from "./featureExtractor";

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
  output.appendLine("SustainaDev OutputChannel created ✅");
  output.appendLine(`Triggered at: ${new Date().toISOString()}`);

  const targetFile = editor.document.uri.fsPath;
  output.appendLine(`Active file: ${targetFile}`);

  const documentText = editor.document.getText();

  // ---------- 1) Detect method ----------
  const cursorOffset = editor.document.offsetAt(editor.selection.active) ?? 0;
  const beforeCursor = documentText.slice(0, cursorOffset);

  const methodMatch = beforeCursor.match(/(\w+)\s*\([^)]*\)\s*\{/g);
  const targetMethodName = methodMatch
    ? methodMatch[methodMatch.length - 1].match(/(\w+)\s*\(/)?.[1]
    : null;

  if (!targetMethodName) {
    output.appendLine("ERROR: Could not detect method.");
    vscode.window.showErrorMessage("Could not detect the method.");
    return;
  }

  output.appendLine(`Detected method: ${targetMethodName}`);

  // ---------- 2) Tree-sitter ----------
  output.appendLine("Running Tree-sitter analyzer...");

  const language = detectLanguage(targetFile);
  const ast = parseCode(documentText, language);
  const features = extractFeatures(ast);

  // ---------- 3) Convert to MethodFacts ----------
  const beforeFacts = {
    methodName: targetMethodName,
    callsSelf: features.recursion,
    maxLoopDepth: features.loopDepth,
    cyclomaticComplexity: 1,

    isLinearRecursion: false,
    isPureAccumulation: false,
    hasOverlappingSubproblems: false,

    hasStringConcatInLoop: features.stringConcatInLoop,
    hasSortingCall: features.sortingCalls > 0,
    sortInsideLoop: features.sortingInsideLoop,
  };

  output.appendLine("=== FEATURES ===");
  output.appendLine(JSON.stringify(features, null, 2));

  // ---------- 4) RULE ENGINE + FALLBACK ----------
  const ruleDecision = detectByRules(features);

  let decision;

  if (ruleDecision) {
    decision = { type: ruleDecision };
    output.appendLine(`⚡ Rule Engine decision: ${ruleDecision}`);
  } else {
    decision = chooseRefactor(beforeFacts);
    output.appendLine(`🤖 AI fallback decision: ${decision.type}`);
  }

  // ---------- 5) Generate Patch ----------
  output.appendLine("Generating optimization...");

  let patch: { preview: string; reason: string };

  try {
    patch = await buildOptimizationPatch(documentText, range, targetFile, {
      targetMethodName: beforeFacts.methodName,
      smellType: decision.type,
      methodFacts: beforeFacts,
    });

    output.appendLine(`Patch reason: ${patch.reason}`);
  } catch (e: any) {
    if (String(e?.message || e).includes("ALREADY_OPTIMIZED")) {
      vscode.window.showInformationMessage("Already optimized ✅");
      return;
    }

    vscode.window.showErrorMessage(`Optimization failed: ${e}`);
    return;
  }

  if (!patch.preview || patch.preview.trim() === documentText.trim()) {
    vscode.window.showInformationMessage("No changes needed");
    return;
  }

  // ---------- 6) Confirm ----------
  const choice = await vscode.window.showQuickPick(
    ["✅ Accept", "❌ Reject"],
    { placeHolder: "Apply optimization?" }
  );

  if (choice !== "✅ Accept") {
    vscode.window.showInformationMessage("Rejected");
    return;
  }

  // ---------- 7) Apply ----------
  const fullRange = new vscode.Range(
    editor.document.positionAt(0),
    editor.document.positionAt(documentText.length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, fullRange, patch.preview);

  await vscode.workspace.applyEdit(edit);
  await editor.document.save();

  vscode.window.showInformationMessage("Optimization applied 🚀");

  output.appendLine("Done ✅");
}