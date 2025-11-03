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
// ... other imports
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
        "C:\\Users\\mosta\\OneDrive - Misr International University\\Desktop\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
      );
      const projectPath = "C:\\Users\\mosta\\OneDrive - Misr International University\\Desktop\\SustainaDev\\testcode";
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
            isRunning = false; // Release lock
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
          isRunning = false; // Release lock
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
        // =========== LOGIC FLOW FIX: 'Extract Method' block ==============
        // =================================================================
        if ((decision.type as string) === "Extract Method") {
          
          // --- ALL 'EXTRACT METHOD' LOGIC IS NOW INSIDE THIS 'IF' BLOCK ---

          const jarPath = path.join(
            "C:\\Users\\mosta\\OneDrive - Misr International University\\Desktop\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
          );
          const projectPath = path.dirname(filePath);
          const analyzerCmd = `java -jar "${jarPath}" "${projectPath}"`;

          console.log("🔍 Running Analyzer:", analyzerCmd);

          try {
            await new Promise((resolve, reject) => {
              const proc = require("child_process").exec(
                analyzerCmd,
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

          // Use the static import
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
            return; // Exit function, finally block will run
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
            // Find and close the preview
            const previewEditor = vscode.window.visibleTextEditors.find((e) =>
              e.document.uri.toString().includes("RefactorPreview.java")
            );
            if (previewEditor) {
                await vscode.window.showTextDocument(previewEditor.document, { preview: false });
                await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
            }
            vscode.window.showInformationMessage("❌ Refactor canceled.");
            return; // Exit function, finally block will run
          }

          // ✅ Close the preview (it's applied below)
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
            return; // Exit function, finally block will run
          }

          await vscode.commands.executeCommand("editor.action.formatDocument");
          await vscode.window.showTextDocument(originalUri, { preview: false });
          await refreshedDoc.save();
          vscode.window.showInformationMessage(
            "✅ Refactor applied successfully!"
          );

          // re-run to get "after" metrics
          const after = await runLizard(filePath);
          const afterFn =
            after.functions.find((f) => f.name === worst.name) ?? worst;

          const explanation = buildExplanation(
            worst.name,
            { ccn: worst.ccn, nloc: worst.nloc },
            { ccn: afterFn.ccn, nloc: afterFn.nloc }
          );
          vscode.window.showInformationMessage(explanation);

          // commit
          const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
          const msg = `Extract Method in ${worst.name}: CCN ${worst.ccn}→${afterFn.ccn}`;
          await gitCommit(ws, msg);

          // === RefactoringMiner verification ===
          let verified = false;
          if (useRM) {
            try {
              verified = (await verifyLastRefactor(ws)).length > 0;
            } catch (e: any) {
              vscode.window.showWarningMessage(
                `RefactoringMiner verification failed; continuing without it. ${
                  e?.message ?? ""
                }`.trim()
              );
              verified = false;
            }
          } else {
            vscode.window.showInformationMessage(
              "RefactoringMiner is disabled; skipping verification."
            );
          }
          // ===================================

          // energy estimate
          const deltaCCN = Math.max(worst.ccn - afterFn.ccn, 0);
          const energy = await estimateEnergy(deltaCCN);

          // log
          appendLog(ws, {
            timestamp: new Date().toISOString(),
            file: filePath,
            refactor: "Extract Method",
            before: { ccn: worst.ccn, nloc: worst.nloc },
            after: { ccn: afterFn.ccn, nloc: afterFn.nloc },
            delta: { ccn: deltaCCN, nloc: worst.nloc - afterFn.nloc },
            verify: { refminer: verified },
            energy,
            commit: { message: msg },
          });

          vscode.window.showInformationMessage(
            "Refactor applied, committed, and logged." +
              (useRM ? "" : " (Verification skipped)")
          );
        
// =================================================================
// =========== LOGIC FLOW FIX: 'Inline Method' block ==============
// =================================================================
} else if ((decision.type as string) === "Inline Method") {
  vscode.window.showInformationMessage("💡 Inline Method chosen");

  const patch = await buildInlinePatch(fullCode, worst.name, filePath);
  if (!patch || !patch.preview || patch.preview.trim().length < 10) {
    vscode.window.showErrorMessage("AI failed to generate inline patch.");
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

  const apply = await vscode.window.showQuickPick(["Apply refactor", "Cancel"], {
    placeHolder: "Apply Inline Method?",
  });
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

  vscode.window.showInformationMessage("✅ Inline Method applied successfully!");
}


 else {
          vscode.window.showInformationMessage(
            "No actionable refactor suggested."
          );
          return; // Exit function, finally block will run
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
        // ... Your dashboard code (unchanged) ...
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
            html = `<html><body><h3>Dashboard error</h3><pre>${e?.message ?? e
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