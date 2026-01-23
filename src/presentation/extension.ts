import * as vscode from "vscode";
import * as path from "path";
import { buildOptimizationReport } from "../business/complexity/report";
import * as fs from "fs";
import { estimateEnergy } from "../data/metrics/codeCarbon";


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
export let sustainaDevOutput: vscode.OutputChannel;

const validSmells = ["RECURSION", "NESTED_LOOPS", "GENERAL"];

/**
 * SustainaDev Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");
sustainaDevOutput = vscode.window.createOutputChannel("SustainaDev");
sustainaDevOutput.appendLine("SustainaDev activated ✅");

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

  await refreshedDoc.save();

  vscode.window.showInformationMessage("✅ Optimization applied successfully.");

  // ✅ Run analyzer AFTER applying patch
  const afterFactsList = await runJavaAnalyzer(context);
  const afterFacts = afterFactsList.find(m => m.methodName === facts.methodName);

 if (afterFacts) {
   const report = buildOptimizationReport(facts, afterFacts);

const title =
  report.metric === "space"
    ? "=== Space Complexity Report ==="
    : "=== Complexity Report ===";

const label =
  report.metric === "space" ? "Space" : "Before";

sustainaDevOutput.appendLine(title);

if (report.metric === "space") {
  sustainaDevOutput.appendLine(`Space Before: ${report.before}`);
  sustainaDevOutput.appendLine(`Space After:  ${report.after}`);
} else {
  sustainaDevOutput.appendLine(`Before: ${report.before}`);
  sustainaDevOutput.appendLine(`After:  ${report.after}`);
}

sustainaDevOutput.appendLine(`Improvement: ${report.improvement}`);

vscode.window.showInformationMessage(
  report.metric === "space"
    ? `Space improved: ${report.before} → ${report.after}`
    : `Complexity improved: ${report.before} → ${report.after}`
);


    vscode.window.showInformationMessage(
      `Complexity improved: ${report.before} → ${report.after}`
    );
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
if (workspace) {
  await logAlgorithmicOptimization(
    workspace,
    filePath,
    report,
    patch.reason
  );
}

}
 else {
    sustainaDevOutput.appendLine(
      `⚠️ Could not find AFTER facts for method: ${facts.methodName}`
    );
  }
}
 else if (choice) {
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
function bigOToScore(bigO: string): number {
  const s = (bigO || "").replace(/\s+/g, "").toLowerCase();

  // Order: smaller = better
  if (s.includes("o(1)")) return 1;
  if (s.includes("o(logn)") || s.includes("o(log(n))")) return 2;
  if (s.includes("o(n)")) return 3;
  if (s.includes("o(nlogn)") || s.includes("o(nlog(n))")) return 4;
  if (s.includes("o(n^2)") || s.includes("o(n2)")) return 5;
  if (s.includes("o(n^3)") || s.includes("o(n3)")) return 6;
  if (s.includes("o(2^n)") || s.includes("o(2n)")) return 7;
  if (s.includes("o(n!)")) return 8;

  // Unknown format -> neutral
  return 0;
}

async function logAlgorithmicOptimization(
  workspace: string,
  filePath: string,
  report: { metric: string; before: string; after: string; improvement: string },
  reason: string
) {
  const beforeScore = bigOToScore(report.before);
  const afterScore = bigOToScore(report.after);

  // Positive means improvement
  const scoreDelta = Math.max(0, beforeScore - afterScore);

  // Reuse your existing energy estimator (it expects a number).
  // We scale delta a bit so improvements have noticeable values.
  const energy = await estimateEnergy(scoreDelta * 5);

  const logEntry = {
    timestamp: new Date().toISOString(),
    file: path.basename(filePath),
    refactor: "Algorithmic Optimization",
    complexity: {
      metric: report.metric,        // "space" or "time" (whatever your report uses)
      before: report.before,        // e.g. "O(n^2)"
      after: report.after,          // e.g. "O(n)"
      improvement: report.improvement
    },
    energy,
    reason
  };

  const logDir = path.join(workspace, ".sustainadev");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  fs.appendFileSync(
    path.join(logDir, "log.jsonl"),
    JSON.stringify(logEntry) + "\n",
    "utf8"
  );
}

async function handleReadLog(panel: vscode.WebviewPanel, ws: string) {
  try {
    const logDir = path.join(ws, ".sustainadev");
    const logPath = path.join(logDir, "log.jsonl");

    await fsp.mkdir(logDir, { recursive: true });

    // If log doesn't exist yet, return empty logs instead of error
    try {
      await fsp.access(logPath);
    } catch {
      await fsp.writeFile(logPath, "", "utf8");
      panel.webview.postMessage({ type: "logContent", lines: [] });
      return;
    }

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


