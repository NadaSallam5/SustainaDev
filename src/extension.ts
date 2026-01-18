import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";

// Project internal imports
import { runLizard } from "./analyzer/lizardRunner";
import { buildOptimizationPatch } from "./refactor/optimizeComplexity"; // New optimization module
import { buildInlinePatch } from "./refactor/inlinemethod";
import { buildRenamePatch } from "./refactor/rename-variable";
import { decideRefactorType } from "./refactor/chooseRefactor";
import { gitCommit } from "./git/commit";
import { initPaths } from "./metrics/codeCarbon";

/**
 * SustainaDev Extension Activation
 *
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");

  // ---- Your original analyzer command (kept) ----
  const runAnalyzer = vscode.commands.registerCommand(
    "sustainadev.runAnalyzer",
    () => {
      vscode.window.showInformationMessage(
        "🚀 Running SustainaDev Java Analyzer...",
      );

      const jarPath = path.join(
        "c:\\Users\\MM\\Downloads\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar",
      );
      const projectPath = "c:\\Users\\MM\\Downloads\\SustainaDev\\testcode";
      const command = `java -jar "${jarPath}" "${projectPath}"`;

      const terminal = vscode.window.createTerminal("SustainaDev Analyzer");
      terminal.show();
      terminal.sendText(command);

      exec(command, (error, stdout, stderr) => {
        if (error) {
          vscode.window.showErrorMessage(
            `❌ Analyzer failed: ${error.message}`,
          );
          return;
        }
        if (stderr) console.error(stderr);
        console.log(stdout);
        vscode.window.showInformationMessage(
          "✅ Analysis complete! Check analysis-report.json",
        );
      });
    },
  );

  let isRunning = false;

  // ---- Analyze current file, suggest refactor, preview, apply, commit, log ----
  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    async () => {
      if (isRunning) {
        vscode.window.showWarningMessage(
          "⏳ SustainaDev is still processing. Please wait until the current refactor completes.",
        );
        return;
      }

      isRunning = true;
      vscode.window.showInformationMessage(
        "🚀 SustainaDev pipeline started...",
      );

      try {
        initPaths(context);

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

        const refreshedDoc = await vscode.workspace.openTextDocument(
          editor.document.uri,
        );
        await refreshedDoc.save();

        const analysis = await runLizard(filePath);
        if (!analysis.functions.length) {
          vscode.window.showInformationMessage("No functions found.");
          isRunning = false;
          return;
        }

        const worst = analysis.functions.sort(
          (a, b) => b.ccn - a.ccn || b.nloc - a.nloc,
        )[0];

        const fullCode = refreshedDoc.getText();
        const decision = decideRefactorType({
          ...worst,
          content: fullCode,
        });

        // =================================================================
        // =========== ALGORITHMIC OPTIMIZATION BLOCK ($O(N^2) -> O(N)) =====
        // =================================================================
        if (
          decision.type === "Algorithmic Optimization" ||
          decision.type === "Extract Method"
        ) {
          vscode.window.showInformationMessage(
            `🤖 Optimizing Big-O for "${worst.name}"...`,
          );

          const patch = await buildOptimizationPatch(
            fullCode,
            { from: worst.start, to: worst.end },
            filePath,
            { targetMethodName: worst.name },
          );

          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI returned incomplete or invalid optimization output.",
            );
            return;
          }

          // 🧹 Close any old preview
          const oldDoc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === "untitled:RefactorPreview.java",
          );
          if (oldDoc) {
            await vscode.window.showTextDocument(oldDoc);
            await vscode.commands.executeCommand(
              "workbench.action.revertAndCloseActiveEditor",
            );
          }

          // 🆕 Create a new in-memory preview document
          const right = vscode.Uri.parse("untitled:RefactorPreview.java");
          const edit = new vscode.WorkspaceEdit();
          edit.insert(right, new vscode.Position(0, 0), patch.preview);
          await vscode.workspace.applyEdit(edit);
          await new Promise((resolve) => setTimeout(resolve, 200));

          // 💡 Show the diff preview
          await vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            right,
            "🔄 SustainaDev: Algorithmic Optimization (Original ← → Optimized)",
            { preview: true },
          );

          // 🧭 Ask user whether to apply
          const apply = await vscode.window.showQuickPick(
            ["Apply optimization", "Cancel"],
            { placeHolder: "Apply Algorithmic Optimization to save energy?" },
          );

          if (apply !== "Apply optimization") {
            const previewEditor = vscode.window.visibleTextEditors.find((e) =>
              e.document.uri.toString().includes("RefactorPreview.java"),
            );
            if (previewEditor) {
              await vscode.window.showTextDocument(previewEditor.document, {
                preview: false,
              });
              await vscode.commands.executeCommand(
                "workbench.action.revertAndCloseActiveEditor",
              );
            }
            vscode.window.showInformationMessage("❌ Optimization canceled.");
            return;
          }

          // ✅ Close the preview
          const previewEditor = vscode.window.visibleTextEditors.find((e) =>
            e.document.uri.toString().includes("Preview"),
          );
          if (previewEditor) {
            await vscode.window.showTextDocument(previewEditor.document, {
              preview: false,
            });
            await vscode.commands.executeCommand(
              "workbench.action.revertAndCloseActiveEditor",
            );
          }

          // ✅ Apply the patch to the original file
          const we = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(refreshedDoc.lineCount, 0),
          );
          we.replace(originalUri, fullRange, patch.preview);

          const applied = await vscode.workspace.applyEdit(we);
          if (!applied) {
            vscode.window.showErrorMessage(
              "Failed to apply optimization edits.",
            );
            return;
          }

          await vscode.commands.executeCommand("editor.action.formatDocument");
          await vscode.window.showTextDocument(originalUri, { preview: false });
          await refreshedDoc.save();

          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
          await gitCommit(
            ws,
            `Optimize Big-O in ${worst.name}: ${patch.reason}`,
          );
          vscode.window.showInformationMessage(
            "✅ Optimization applied and logged!",
          );

          // =================================================================
          // =========== INLINE METHOD BLOCK ==============
          // =================================================================
        } else if (decision.type === "Inline Method") {
          vscode.window.showInformationMessage("💡 Inline Method chosen");

          const patch = await buildInlinePatch(fullCode, worst.name, filePath);
          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI failed to generate inline patch.",
            );
            return;
          }

          const right = vscode.Uri.parse("untitled:RefactorPreview.java");
          const edit = new vscode.WorkspaceEdit();
          edit.insert(right, new vscode.Position(0, 0), patch.preview);
          await vscode.workspace.applyEdit(edit);
          await new Promise((resolve) => setTimeout(resolve, 200));

          await vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            right,
            "🔄 Proposed Inline Refactoring (Original ← → Refactored)",
            { preview: true },
          );

          const apply = await vscode.window.showQuickPick(
            ["Apply refactor", "Cancel"],
            { placeHolder: "Apply Inline Method?" },
          );
          if (apply === "Apply refactor") {
            const we = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(refreshedDoc.lineCount, 0),
            );
            we.replace(originalUri, fullRange, patch.preview);
            await vscode.workspace.applyEdit(we);
            await vscode.commands.executeCommand(
              "editor.action.formatDocument",
            );
            await refreshedDoc.save();
            const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
            await gitCommit(ws, `Inline Method in ${worst.name}`);
            vscode.window.showInformationMessage(
              "✅ Inline Method applied successfully!",
            );
          }
          await vscode.commands.executeCommand(
            "workbench.action.revertAndCloseActiveEditor",
          );

          // =================================================================
          // =========== RENAME VARIABLE BLOCK ==============
          // =================================================================
        } else if (decision.type === "Rename Variable") {
          vscode.window.showInformationMessage("💡 Rename Variable chosen");

          const oldName = decision.candidate || "variable";
          const patch = await buildRenamePatch(
            fullCode,
            oldName,
            { from: worst.start, to: worst.end },
            filePath,
          );

          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI failed to generate rename patch.",
            );
            return;
          }

          const right = vscode.Uri.parse("untitled:RefactorPreview.java");
          const edit = new vscode.WorkspaceEdit();
          edit.insert(right, new vscode.Position(0, 0), patch.preview);
          await vscode.workspace.applyEdit(edit);
          await new Promise((resolve) => setTimeout(resolve, 200));

          await vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            right,
            "🔄 Proposed Rename Refactoring (Original ← → Refactored)",
            { preview: true },
          );

          const apply = await vscode.window.showQuickPick(
            ["Apply refactor", "Cancel"],
            { placeHolder: "Apply Rename Variable?" },
          );
          if (apply === "Apply refactor") {
            const we = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(refreshedDoc.lineCount, 0),
            );
            we.replace(originalUri, fullRange, patch.preview);
            await vscode.workspace.applyEdit(we);
            await vscode.commands.executeCommand(
              "editor.action.formatDocument",
            );
            await refreshedDoc.save();
            const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
            await gitCommit(ws, `Rename Variable in ${worst.name}`);
            vscode.window.showInformationMessage(
              "✅ Rename applied successfully!",
            );
          }
          await vscode.commands.executeCommand(
            "workbench.action.revertAndCloseActiveEditor",
          );
        } else {
          vscode.window.showInformationMessage(
            "No actionable refactor suggested.",
          );
          return;
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `❌ SustainaDev failed: ${err.message || err}`,
        );
      } finally {
        isRunning = false;
        vscode.window.showInformationMessage(
          "🟢 SustainaDev pipeline ready for next run.",
        );
      }
    },
  );

  // ---- Dashboard Command ----
  const openDash = vscode.commands.registerCommand(
    "sustainadev.openDashboard",
    async () => {
      const panel = vscode.window.createWebviewPanel(
        "sustainadevDashboard",
        "SustainaDev Dashboard",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(context.extensionPath, "media")),
          ],
        },
      );

      const dashboardPath = path.join(
        context.extensionPath,
        "media",
        "dashboard.html",
      );
      let html = "";
      try {
        html = await fsp.readFile(dashboardPath, "utf8");
      } catch (e: any) {
        html = `<html><body><h3>Dashboard error</h3><pre>${e?.message ?? e}</pre></body></html>`;
      }
      panel.webview.html = html;

      panel.webview.onDidReceiveMessage(
        async (message: any) => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) return;
          const ws = workspaceFolder.uri.fsPath;

          if (message?.type === "readAnalysis") {
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

          if (message?.type === "readLog") {
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
        },
        undefined,
        context.subscriptions,
      );
    },
  );

  context.subscriptions.push(runAnalyzer, analyzeActiveFile, openDash);
}

export function deactivate() {}
