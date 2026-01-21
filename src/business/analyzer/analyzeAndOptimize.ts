
import { chooseRefactor } from "../refactor/chooseRefactor";
import { buildOptimizationPatch } from "../refactor/optimizeComplexity";


import { runJavaAnalyzer } from "./javaRunner";
import * as vscode from "vscode";



export async function analyzeAndOptimize(
  context: vscode.ExtensionContext,
  code: string,
  filePath: string,
  range: { from: number; to: number }
) {

  // 🔥 STEP 4 — THIS GOES HERE (FIRST THING)
 const editor = vscode.window.activeTextEditor;
if (!editor) {
  throw new Error("No active editor");
}



const factsList = await runJavaAnalyzer(context);


  if (!factsList || factsList.length === 0) {
    throw new Error("No MethodFacts received from Java analyzer");
  }

  // ✅ NOW your existing logic continues
  // 🔹 1. استخرج اسم الميثود من مكان الكيرسور
const documentText = code;
const cursorOffset =
  vscode.window.activeTextEditor?.document.offsetAt(
    vscode.window.activeTextEditor.selection.active
  ) ?? 0;

const beforeCursor = documentText.slice(0, cursorOffset);

// regex بسيط يجيب آخر method قبل الكيرسور
const methodMatch = beforeCursor.match(/(\w+)\s*\([^)]*\)\s*\{/g);
const targetMethodName = methodMatch
  ? methodMatch[methodMatch.length - 1]
      .match(/(\w+)\s*\(/)?.[1]
  : null;

if (!targetMethodName) {
  vscode.window.showErrorMessage(
    "Could not detect the method at cursor position."
  );
  return;
}

// 🔹 2. هات الـ facts الصح
const facts = factsList.find(
  f => f.methodName === targetMethodName
);

if (!facts) {
  vscode.window.showErrorMessage(
    `No analysis facts found for method ${targetMethodName}`
  );
  return;
}

// 🔹 3. decision + optimization
const decision = chooseRefactor(facts);

await buildOptimizationPatch(code, range, filePath, {
  targetMethodName: facts.methodName,
  smellType: decision.type,
  methodFacts: facts,
});

}

