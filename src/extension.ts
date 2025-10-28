import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";

import { runLizard } from "./analyzer/lizardRunner";
import { chooseRefactor } from "./analyzer/smellClassifier";
import { buildExtractPatch } from "./refactor/extractMethod";
import { buildExplanation } from "./refactor/explanation";
import { gitCommit } from "./git/commit";
import { verifyLastRefactor } from "./git/refactoringMiner";
import { estimateEnergy } from "./metrics/codeCarbon";
import { appendLog } from "./metrics/logger";

export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");

  // ---- 1️⃣ Run Analyzer Command ----
  const runAnalyzer = vscode.commands.registerCommand(
    "sustainadev.runAnalyzer",
    () => {
      vscode.window.showInformationMessage(
        "🚀 Running SustainaDev Java Analyzer..."
      );

      const jarPath = path.join(
        "C:\\Users\\MM\\Downloads\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
      );
      const projectPath = "C:\\Users\\MM\\Downloads\\SustainaDev\\testcode";
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

  // ---- 2️⃣ Analyze Active File ----
  let isRunning = false;
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
        if (!editor) return;
        if (editor.document.isDirty) await editor.document.save();

        const cfg = vscode.workspace.getConfiguration("sustainadev");
        const useRM = cfg.get<boolean>("enableRefactoringMiner") === true;

        const filePath = editor.document.uri.fsPath;

        // Run complexity analysis
        const analysis = await runLizard(filePath);
        if (!analysis.functions.length) {
          vscode.window.showInformationMessage("No functions found.");
          return;
        }

        const worst = analysis.functions.sort(
          (a, b) => b.ccn - a.ccn || b.nloc - a.nloc
        )[0];
        const decision = chooseRefactor(worst);

        if (decision.type !== "Extract Method") {
          vscode.window.showInformationMessage(
            "No actionable refactor (demo thresholds)."
          );
          return;
        }

        // Run Java Analyzer
        const jarPath = path.join(
          "C:\\Users\\MM\\Downloads\\SustainaDev\\target\\javatool-1.0-SNAPSHOT-jar-with-dependencies.jar"
        );
        const projectPath = path.dirname(filePath);
        const analyzerCmd = `java -jar "${jarPath}" "${projectPath}"`;

        try {
          await new Promise((resolve, reject) => {
            exec(analyzerCmd, (err, stdout, stderr) => {
              if (err) reject(err);
              else resolve(null);
            });
          });
        } catch (err: any) {
          vscode.window.showWarningMessage(
            `⚠️ Analyzer failed to run: ${err.message}. Using fallback.`
          );
        }

        // Read analyzer output
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
            const report = JSON.parse(fs.readFileSync(analyzerReport, "utf8"));
            const fileReport = report.find((r: any) =>
              r.file.includes(path.basename(filePath))
            );
            const method = fileReport?.methods?.find(
              (m: any) => m.name === worst.name
            );
            if (method) {
              methodBody = method.body ?? "";
              locals = method.locals ?? [];
              from = method.extractableStart ?? from;
              to = method.extractableEnd ?? to;
            }
          } catch (err) {
            console.error("❌ Failed reading analyzer output:", err);
          }
        }

        // Generate patch
        const fullCode = editor.document.getText();
        const patch = await buildExtractPatch(
          fullCode,
          { from, to },
          path.basename(filePath),
          { methodBody, locals }
        );

        if (!patch?.preview || patch.preview.trim().length < 10) {
          vscode.window.showErrorMessage(
            "AI returned incomplete or invalid refactor output."
          );
          return;
        }

        // Create preview
        const right = vscode.Uri.parse("untitled:RefactorPreview.java");
        const edit = new vscode.WorkspaceEdit();
        edit.insert(right, new vscode.Position(0, 0), patch.preview);
        await vscode.workspace.applyEdit(edit);
        await new Promise((resolve) => setTimeout(resolve, 200));

        await vscode.commands.executeCommand(
          "vscode.diff",
          editor.document.uri,
          right,
          "🔄 Proposed Refactoring",
          { preview: true }
        );

        // Ask user
        const apply = await vscode.window.showQuickPick(
          ["Apply refactor", "Cancel"],
          { placeHolder: "Apply Extract Method?" }
        );
        if (apply !== "Apply refactor") {
          vscode.window.showInformationMessage(
            "❌ Refactor canceled — preview closed without saving."
          );
          return;
        }

        // Apply patch to original file
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(editor.document.lineCount, 0)
        );
        const we = new vscode.WorkspaceEdit();
        we.replace(editor.document.uri, fullRange, patch.preview);
        const applied = await vscode.workspace.applyEdit(we);

        if (!applied) {
          vscode.window.showErrorMessage("Failed to apply refactor edits.");
          return;
        }

        await vscode.commands.executeCommand("editor.action.formatDocument");
        await editor.document.save();
        vscode.window.showInformationMessage(
          "✅ Refactor applied successfully!"
        );

        // Re-analyze after refactor
        const after = await runLizard(filePath);
        const afterFn =
          after.functions.find((f) => f.name === worst.name) ?? worst;

        const explanation = buildExplanation(
          worst.name,
          { ccn: worst.ccn, nloc: worst.nloc },
          { ccn: afterFn.ccn, nloc: afterFn.nloc }
        );
        vscode.window.showInformationMessage(explanation);

        // Commit changes
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
        const msg = `Extract Method in ${worst.name}: CCN ${worst.ccn}→${afterFn.ccn}`;
        await gitCommit(ws, msg);

        // Verify refactor (optional)
        let verified = false;
        if (useRM) {
          try {
            verified = (await verifyLastRefactor(ws)).length > 0;
          } catch (e: any) {
            vscode.window.showWarningMessage(
              `RefactoringMiner verification failed: ${e?.message ?? ""}`
            );
          }
        }

        // Estimate energy + log
        const deltaCCN = Math.max(worst.ccn - afterFn.ccn, 0);
        const energy = await estimateEnergy(deltaCCN).catch(() => null);

        try {
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
        } catch (e: any) {
          vscode.window.showWarningMessage(
            `Log append failed: ${e?.message ?? e}`
          );
        }

        vscode.window.showInformationMessage(
          "Refactor applied, committed, and logged." +
            (useRM ? "" : " (Verification skipped)")
        );
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

  // ---- 3️⃣ Dashboard Command ----
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
      try {
        panel.webview.html = await fsp.readFile(dashboardPath, "utf8");
      } catch (e: any) {
        panel.webview.html = `<html><body><h3>Dashboard error</h3><pre>${
          e?.message ?? e
        }</pre></body></html>`;
      }

      panel.webview.onDidReceiveMessage(
        async (message: any) => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) return;
          const ws = workspaceFolder.uri.fsPath;

          if (message?.type === "readAnalysis") {
            try {
              const content = await fsp.readFile(
                path.join(ws, "analysis-report.json"),
                "utf8"
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
              if (!fs.existsSync(logPath))
                throw new Error("log.jsonl not found");
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
