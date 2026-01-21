import * as vscode from "vscode";
import * as path from "path";


import * as fsp from "fs/promises";

// Project internal imports

import { buildOptimizationPatch } from "../business/refactor/optimizeComplexity";
import { chooseRefactor } from "../business/refactor/chooseRefactor";
import { initPaths } from "../data/metrics/codeCarbon";
import { runJavaAnalyzer } from "../business/analyzer/javaRunner";

/**
 * Global state to prevent concurrent executions
 */
let isRunning = false;
const validSmells = ["RECURSION", "NESTED_LOOPS", "GENERAL"];

/**
 * SustainaDev Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");

  // 1. Register Analyzer Command
 

  // 2. Register Active File Analysis Command
  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    () => executeAnalyzeActiveFile(context),
  );

  // 3. Register Dashboard Command
  const openDash = vscode.commands.registerCommand(
    "sustainadev.openDashboard",
    () => executeOpenDashboard(context),
  );

  context.subscriptions.push( analyzeActiveFile, openDash);
}

export function deactivate() {}

/* =========================================================================
   COMMAND IMPLEMENTATIONS
   ========================================================================= */

/**
 * Logic for 'sustainadev.runAnalyzer'
 */


/**
 * Logic for 'sustainadev.analyzeActiveFile'
 */
async function executeAnalyzeActiveFile(context: vscode.ExtensionContext) {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes.",
    );
    return;
  }

  isRunning = true;
  vscode.window.showInformationMessage("🚀 SustainaDev pipeline started...");

  try {
    initPaths(context);

    // 1. Validation & Setup
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.isDirty) {
      await editor.document.save();
    }
    if (!editor) {
      isRunning = false;
      return;
    }

    const originalUri = editor.document.uri;
    const filePath = originalUri.fsPath;
    const refreshedDoc = await vscode.workspace.openTextDocument(originalUri);
    await refreshedDoc.save();

const fullCode = refreshedDoc.getText();

const factsList = await runJavaAnalyzer(context);

if (!factsList.length) {
  vscode.window.showInformationMessage("No methods detected by analyzer.");
  isRunning = false;
  return;
}


// OPTIONAL: choose one method (first or highest complexity later)
const facts = factsList[0];

// 🔥 RULE ENGINE (WHAT to do)
const decision = chooseRefactor(facts);

    // 3. Execution Logic
    if (validSmells.includes(decision.type)) {
     const patch = await buildOptimizationPatch(
  fullCode,
  {
    from: editor.selection.start.line,
    to: editor.selection.end.line,
  },
  filePath,
  {
    targetMethodName: facts.methodName,
    smellType: decision.type,
    methodFacts: facts, // ✅ REQUIRED
  }
);

void vscode.window.showQuickPick(
  ["✅ Accept Optimization", "❌ Reject"],
  {
    placeHolder: "Apply the optimized code?",
  }
).then(async (choice) => {
  if (choice === "✅ Accept Optimization") {
    await applyPatchToDocument(
      originalUri,
      patch.preview,
      refreshedDoc.lineCount
    );

    vscode.window.showInformationMessage(
      "✅ Optimization applied successfully."
    );
  } else if (choice) {
    vscode.window.showInformationMessage(
      "❌ Optimization discarded."
    );
  }
});


    } else {
      vscode.window.showInformationMessage("No actionable refactor suggested.");
    }
  } catch (err: any) {
    // 🛡️ Graceful Handling for ALREADY_OPTIMIZED
    if (err.message === "ALREADY_OPTIMIZED") {
      isRunning = false;
      return;
    }
    vscode.window.showErrorMessage(
      `❌ SustainaDev failed: ${err.message || err}`,
    );
  } finally {
    isRunning = false;
    vscode.window.showInformationMessage(
      "🟢 SustainaDev pipeline ready for next run.",
    );
  }
}

/**
 * Helper to handle the specific optimization workflow
 */

/**
 * Logic for 'sustainadev.openDashboard'
 */
async function executeOpenDashboard(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "sustainadevDashboard",
    "SustainaDev Dashboard",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(
          path.join(
            context.extensionPath,
            "src",
            "presentation",
            "media"
          )
        ),
      ],
    }
  );

  const dashboardPath = path.join(
    context.extensionPath,
    "src",
    "presentation",
    "media",
    "dashboard.html"
  );

  try {
    const html = await fsp.readFile(dashboardPath, "utf8");
    panel.webview.html = html;
  } catch (e: any) {
    panel.webview.html = `
      <html>
        <body>
          <h3>Dashboard error</h3>
          <pre>${e?.message ?? e}</pre>
        </body>
      </html>`;
  }

  // Message Handling (this part was already correct)
  panel.webview.onDidReceiveMessage(
    async (message: any) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const ws = workspaceFolder.uri.fsPath;

      if (message?.type === "readAnalysis") {
        await handleReadAnalysis(panel, ws);
      } else if (message?.type === "readLog") {
        await handleReadLog(panel, ws);
      }
    },
    undefined,
    context.subscriptions
  );
}


/* =========================================================================
   HELPER FUNCTIONS
   ========================================================================= */

async function closeExistingPreview(uriStringPartial: string) {
  const oldDoc = vscode.workspace.textDocuments.find((d) =>
    d.uri.toString().includes(uriStringPartial),
  );
  if (oldDoc) {
    // Attempt to show it so we can close it, or check visible editors
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document === oldDoc,
    );
    if (editor) {
      await vscode.window.showTextDocument(oldDoc, {
        preview: false,
        preserveFocus: false,
      });
      await vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
    }
  }
}

async function createAndShowPreview(
  previewUri: vscode.Uri,
  content: string,
  originalUri: vscode.Uri,
) {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(previewUri, new vscode.Position(0, 0), content);
  await vscode.workspace.applyEdit(edit);

  // Wait briefly for FS update
  await new Promise((resolve) => setTimeout(resolve, 200));

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    previewUri,
    "🔄 SustainaDev: Algorithmic Optimization (Original ← → Optimized)",
    { preview: true },
  );
}

async function applyPatchToDocument(
  uri: vscode.Uri,
  content: string,
  lineCount: number,
) {
  const we = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(lineCount, 0),
  );
  we.replace(uri, fullRange, content);

  const applied = await vscode.workspace.applyEdit(we);
  if (!applied) {
    throw new Error("Failed to apply optimization edits.");
  }

  await vscode.commands.executeCommand("editor.action.formatDocument");
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function handleReadAnalysis(panel: vscode.WebviewPanel, ws: string) {
  try {
    const content = await fsp.readFile(
      path.join(ws, "analysis-report.json"),
      "utf8",
    );
    panel.webview.postMessage({ type: "analysisContent", content });
  } catch (e: any) {
    panel.webview.postMessage({
      type: "analysisError",
      error: e?.message ?? String(e),
    });
  }
}

async function handleReadLog(panel: vscode.WebviewPanel, ws: string) {
  try {
    const logPath = path.join(ws, ".sustainadev", "log.jsonl");
    const raw = await fsp.readFile(logPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    panel.webview.postMessage({ type: "logContent", lines });
  } catch (e: any) {
    panel.webview.postMessage({
      type: "logError",
      error: e?.message ?? String(e),
    });
  }
}
