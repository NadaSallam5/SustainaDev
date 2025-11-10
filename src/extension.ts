import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import * as fs from "fs";
// NEW imports for PoC flow
import { runLizard } from "./analyzer/lizardRunner";
import { chooseRefactor } from "./analyzer/smellClassifier";
import { buildExtractPatch, extractClassBlock } from "./refactor/extractMethod";
import { buildExplanation } from "./refactor/explanation";
import { gitCommit } from "./git/commit";
import { verifyLastRefactor } from "./git/refactoringMiner";
import { estimateEnergy } from "./metrics/codeCarbon";
import { appendLog } from "./metrics/logger";
import * as fsp from "fs/promises";
import { decideRefactorType } from "./refactor/chooseRefactor";
import { buildInlinePatch } from "./refactor/inlinemethod";
import { buildRenamePatch } from "./refactor/rename-variable";

export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");

  // ---- Your original analyzer command (kept) ----
  const runAnalyzer = vscode.commands.registerCommand(
    "sustainadev.runAnalyzer",
    () => {
      vscode.window.showInformationMessage(
        "🚀 Running SustainaDev Java Analyzer..."
      );

      const jarPath = path.join(
        "c:\\Users\\MM\\Downloads\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
      );
      const projectPath = "c:\\Users\\MM\\Downloads\\SustainaDev\\testcode";
      const command = `java -jar "${jarPath}" "${projectPath}"`;

      const terminal = vscode.window.createTerminal("SustainaDev Analyzer");
      terminal.show();
      terminal.sendText(command);

      exec(command, (error, stdout, stderr) => {
        if (error) {
          vscode.window.showErrorMessage(
            `❌ Analyzer failed: ${error.message}`
          );
          return;
        }
        if (stderr) console.error(stderr);
        console.log(stdout);
        vscode.window.showInformationMessage(
          "✅ Analysis complete! Check analysis-report.json"
        );
      });
    }
  );

  let isRunning = false;

  // ---- Analyze current file, suggest refactor, preview, apply, commit, verify (optional), log ----
  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    async () => {
      if (isRunning) {
        vscode.window.showWarningMessage(
          "⏳ SustainaDev is still processing. Please wait until the current refactor completes."
        );
        return;
      }

      isRunning = true;
      vscode.window.showInformationMessage(
        "🚀 SustainaDev pipeline started..."
      );

      try {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.isDirty) {
          await editor.document.save();
        }
        if (!editor) {
          isRunning = false;
          return;
        }

        const cfg = vscode.workspace.getConfiguration("sustainadev");
        const useRM = cfg.get<boolean>("enableRefactoringMiner") === true;

        const originalUri = editor.document.uri;
        const filePath = originalUri.fsPath;

        const refreshedDoc = await vscode.workspace.openTextDocument(
          editor.document.uri
        );
        await refreshedDoc.save();

        const analysis = await runLizard(filePath);
        if (!analysis.functions.length) {
          vscode.window.showInformationMessage("No functions found.");
          isRunning = false;
          return;
        }

        const worst = analysis.functions.sort(
          (a, b) => b.ccn - a.ccn || b.nloc - a.nloc
        )[0];

        const decision = decideRefactorType({
          ...worst,
          content: refreshedDoc.getText().toString(),
        });
        const fullCode = refreshedDoc.getText();

        // =================================================================
        // =========== EXTRACT METHOD BLOCK (FIXED - NO DUPLICATE LOGGING) ==
        // =================================================================
        if ((decision.type as string) === "Extract Method") {
          const jarPath = path.join(
            "c:\\Users\\MM\\Downloads\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
          );
          const projectPath = path.dirname(filePath);
          const analyzerCmd = `java -jar "${jarPath}" "${projectPath}"`;

          console.log("🔍 Running Analyzer:", analyzerCmd);

          try {
            await new Promise((resolve, reject) => {
              const proc = require("child_process").exec(
                analyzerCmd,
                { cwd: projectPath },
                (err: any, stdout: string, stderr: string) => {
                  if (err) {
                    console.error("❌ Analyzer failed:", err.message);
                    console.error("stderr:", stderr);
                    reject(err);
                  } else {
                    console.log("✅ Analyzer output:", stdout);
                    resolve(null);
                  }
                }
              );
            });
          } catch (err: any) {
            vscode.window.showWarningMessage(
              `⚠️ Analyzer failed to run: ${err.message}. Using Lizard fallback.`
            );
            console.error("Analyzer execution error:", err);
          }

          let from = worst.start;
          let to = worst.end;
          let methodBody = "";
          let locals: string[] = [];
          const analyzerReport = path.join(
            path.dirname(filePath),
            "analysis-report.json"
          );
          if (fs.existsSync(analyzerReport)) {
            try {
              const report = JSON.parse(
                fs.readFileSync(analyzerReport, "utf8")
              );
              const fileReport = report.find((r: any) =>
                r.file.includes(path.basename(filePath))
              );
              const method = fileReport?.methods?.find(
                (m: any) => m.name === worst.name
              );

              methodBody = method?.body ?? "";
              locals = method?.locals ?? [];

              if (method?.extractableStart && method?.extractableEnd) {
                from = method.extractableStart;
                to = method.extractableEnd;
                console.log(`📊 JavaParser block detected: ${from}-${to}`);
              } else {
                console.log(
                  "⚠️ Analyzer did not find an extractable block. Using Lizard range."
                );
              }
            } catch (err) {
              console.error("❌ Failed reading analyzer output:", err);
            }
          }

          // ✅ buildExtractPatch now handles ALL metrics and logging internally
          const patch = await buildExtractPatch(
            fullCode,
            { from, to },
            path.basename(filePath),
            { methodBody, locals }
          );

          console.log("🧠 AI Patch Response:", patch);
          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI returned incomplete or invalid refactor output."
            );
            return;
          }

          // 🧹 Close any old preview
          const oldDoc = vscode.workspace.textDocuments.find(
            (d) => d.uri.toString() === "untitled:RefactorPreview.java"
          );
          if (oldDoc) {
            await vscode.window.showTextDocument(oldDoc);
            await vscode.commands.executeCommand(
              "workbench.action.revertAndCloseActiveEditor"
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
            "🔄 Proposed Refactoring (Original ← → Refactored)",
            { preview: true }
          );

          // 🧭 Ask user whether to apply
          const apply = await vscode.window.showQuickPick(
            ["Apply refactor", "Cancel"],
            {
              placeHolder: "Apply Extract Method?",
            }
          );
          if (apply !== "Apply refactor") {
            const previewEditor = vscode.window.visibleTextEditors.find((e) =>
              e.document.uri.toString().includes("RefactorPreview.java")
            );
            if (previewEditor) {
              await vscode.window.showTextDocument(previewEditor.document, {
                preview: false,
              });
              await vscode.commands.executeCommand(
                "workbench.action.revertAndCloseActiveEditor"
              );
            }
            vscode.window.showInformationMessage("❌ Refactor canceled.");
            return;
          }

          // ✅ Close the preview
          const previewEditor = vscode.window.visibleTextEditors.find((e) =>
            e.document.uri.toString().includes("Preview")
          );
          if (previewEditor) {
            await vscode.window.showTextDocument(previewEditor.document, {
              preview: false,
            });
            await vscode.commands.executeCommand(
              "workbench.action.revertAndCloseActiveEditor"
            );
          }

          // ✅ Apply the patch to the original file
          const we = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(refreshedDoc.lineCount, 0)
          );
          we.replace(originalUri, fullRange, patch.preview);

          const applied = await vscode.workspace.applyEdit(we);
          if (!applied) {
            vscode.window.showErrorMessage("Failed to apply refactor edits.");
            return;
          }

          await vscode.commands.executeCommand("editor.action.formatDocument");
          await vscode.window.showTextDocument(originalUri, { preview: false });
          await refreshedDoc.save();
          vscode.window.showInformationMessage(
            "✅ Refactor applied successfully!"
          );

          // Show simple user message
          vscode.window.showInformationMessage(
            `Extract Method completed for ${worst.name}`
          );

          // Commit
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
          const msg = `Extract Method in ${worst.name}`;
          await gitCommit(ws, msg);

          // === RefactoringMiner verification (optional) ===
          if (useRM) {
            try {
              const verified = (await verifyLastRefactor(ws)).length > 0;
              vscode.window.showInformationMessage(
                verified
                  ? "✅ Refactor verified by RefactoringMiner"
                  : "⚠️ Not verified"
              );
            } catch (e: any) {
              vscode.window.showWarningMessage(
                `RefactoringMiner verification failed: ${
                  e?.message ?? ""
                }`.trim()
              );
            }
          }

          // ❌ REMOVED: Duplicate logging - buildExtractPatch already logged everything!
          // No more appendLog() here - it's all done inside buildExtractPatch with correct metrics

          vscode.window.showInformationMessage(
            "Refactor applied, committed, and logged."
          );

          // =================================================================
          // =========== INLINE METHOD BLOCK ==============
          // =================================================================
        } else if ((decision.type as string) === "Inline Method") {
          vscode.window.showInformationMessage("💡 Inline Method chosen");

          const patch = await buildInlinePatch(fullCode, worst.name, filePath);
          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI failed to generate inline patch."
            );
            return;
          }

          const right = vscode.Uri.parse("untitled:RefactorPreview.java");
          const edit = new vscode.WorkspaceEdit();
          edit.insert(right, new vscode.Position(0, 0), patch.preview);
          await vscode.workspace.applyEdit(edit);
          await new Promise((r) => setTimeout(r, 200));

          await vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            right,
            "🔄 Proposed Inline Refactoring (Original ← → Refactored)",
            { preview: true }
          );

          const apply = await vscode.window.showQuickPick(
            ["Apply refactor", "Cancel"],
            {
              placeHolder: "Apply Inline Method?",
            }
          );
          if (apply !== "Apply refactor") {
            vscode.window.showInformationMessage("❌ Refactor canceled.");
            return;
          }

          const we = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(refreshedDoc.lineCount, 0)
          );
          we.replace(originalUri, fullRange, patch.preview);

          const applied = await vscode.workspace.applyEdit(we);
          if (!applied) {
            vscode.window.showErrorMessage("Failed to apply inline edits.");
            return;
          }

          await vscode.commands.executeCommand("editor.action.formatDocument");
          await vscode.window.showTextDocument(originalUri, { preview: false });
          await refreshedDoc.save();

          vscode.window.showInformationMessage(
            "✅ Inline Method applied successfully!"
          );
        } else if ((decision.type as string) === "Rename Variable") {
          vscode.window.showInformationMessage("💡 Rename Variable chosen");

          // Extract potential variable names from the function content
          const badNames = ["x", "y", "z", "a", "b", "data", "info", "temp"];
          const foundVars = [] as string[];

          if (foundVars.length === 0) {
            vscode.window.showWarningMessage(
              "No unclear variable names found."
            );
            return;
          }

          // Let user pick which one to rename
          const oldName = await vscode.window.showQuickPick(foundVars, {
            placeHolder: "Pick a variable to rename",
          });
          if (!oldName) return;

          const newName = await vscode.window.showInputBox({
            prompt: `Enter a new name for "${oldName}"`,
            placeHolder: "e.g. totalSum, userData, buffer",
          });
          if (!newName) return;

          // Call AI to safely rename just that one variable
          const patch = await buildRenamePatch(
            fullCode,
            oldName,
            newName,
            filePath
          );

          if (!patch || !patch.preview || patch.preview.trim().length < 10) {
            vscode.window.showErrorMessage(
              "AI failed to generate rename patch."
            );
            return;
          }

          // Preview and confirm like your other refactors
          const right = vscode.Uri.parse("untitled:RefactorPreview.java");
          const edit = new vscode.WorkspaceEdit();
          edit.insert(right, new vscode.Position(0, 0), patch.preview);
          await vscode.workspace.applyEdit(edit);
          await new Promise((r) => setTimeout(r, 200));

          await vscode.commands.executeCommand(
            "vscode.diff",
            originalUri,
            right,
            `🔄 Proposed Rename Variable (${oldName} → ${newName})`,
            { preview: true }
          );

          const apply = await vscode.window.showQuickPick(
            ["Apply refactor", "Cancel"],
            {
              placeHolder: `Apply rename for "${oldName}"?`,
            }
          );
          if (apply !== "Apply refactor") return;

          const we = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(refreshedDoc.lineCount, 0)
          );
          we.replace(originalUri, fullRange, patch.preview);
          await vscode.workspace.applyEdit(we);
          await refreshedDoc.save();

          vscode.window.showInformationMessage(
            `✅ Variable "${oldName}" renamed successfully!`
          );
        } else {
          vscode.window.showInformationMessage(
            "No actionable refactor suggested."
          );
          return;
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `❌ SustainaDev failed: ${err.message || err}`
        );
      } finally {
        isRunning = false;
        vscode.window.showInformationMessage(
          "🟢 SustainaDev pipeline ready for next run."
        );
      }
    }
  );

  // ---- Dashboard (reads analysis-report.json and .sustainadev/log.jsonl) ----
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
        }
      );

      const dashboardPath = path.join(
        context.extensionPath,
        "media",
        "dashboard.html"
      );
      let html = "";
      try {
        html = await fsp.readFile(dashboardPath, "utf8");
      } catch (e: any) {
        html = `<html><body><h3>Dashboard error</h3><pre>${
          e?.message ?? e
        }</pre></body></html>`;
      }
      panel.webview.html = html;

      panel.webview.onDidReceiveMessage(
        async (message: any) => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            if (message?.type === "readAnalysis") {
              panel.webview.postMessage({
                type: "analysisError",
                error: "No workspace folder open.",
              });
            }
            if (message?.type === "readLog") {
              panel.webview.postMessage({
                type: "logError",
                error: "No workspace folder open.",
              });
            }
            return;
          }
          const ws = workspaceFolder.uri.fsPath;

          if (message?.type === "readFile") {
            try {
              const filePath = path.join(ws, "analysis-report.json");
              const content = await fsp.readFile(filePath, "utf8");
              panel.webview.postMessage({ type: "fileContent", content });
            } catch (e: any) {
              panel.webview.postMessage({
                type: "fileError",
                error: e?.message ?? String(e),
              });
            }
          }

          if (message?.type === "readAnalysis") {
            try {
              const filePath = path.join(ws, "analysis-report.json");
              const content = await fsp.readFile(filePath, "utf8");
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
              if (!fs.existsSync(logPath)) {
                throw new Error("log.jsonl not found in .sustainadev/");
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
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(runAnalyzer, analyzeActiveFile, openDash);
}

export function deactivate() {}
