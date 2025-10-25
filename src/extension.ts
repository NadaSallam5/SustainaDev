import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";

// NEW imports for PoC flow
import { runLizard } from "./analyzer/lizardRunner";
import { chooseRefactor } from "./analyzer/smellClassifier";
import { buildExtractPatch } from "./refactor/extractMethod";
import { buildExplanation } from "./refactor/explanation";
import { gitCommit } from "./git/commit";
import { verifyLastRefactor } from "./git/refactoringMiner";
import { estimateEnergy } from "./metrics/codeCarbon";
import { appendLog } from "./metrics/logger";
import { openDashboard } from "./ui/dashboardPanel";

export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");

  // ---- Your original analyzer command (kept) ----
  const runAnalyzer = vscode.commands.registerCommand(
    "sustainadev.runAnalyzer",
    () => {
      vscode.window.showInformationMessage(
        "🚀 Running SustainaDev Java Analyzer..."
      );

      // 👉 adjust these paths if needed (escaped backslashes for Windows)
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
        if (!editor) return;

        const cfg = vscode.workspace.getConfiguration("sustainadev");
        const useRM = cfg.get<boolean>("enableRefactoringMiner") === true;

        const originalUri = editor.document.uri;
        const filePath = originalUri.fsPath;

        // 🔄 Force a clean read from disk
        const refreshedDoc = await vscode.workspace.openTextDocument(
          editor.document.uri
        );
        await refreshedDoc.save();

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

        const fullCode = refreshedDoc.getText();

        const patch = await buildExtractPatch(
          fullCode,
          {
            from: worst.start,
            to: worst.end,
          },
          path.basename(filePath)
        );

        // 🧹 Close old preview
        const oldDoc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === "untitled:RefactorPreview.java"
        );
        if (oldDoc) {
          await vscode.window.showTextDocument(oldDoc);
          await vscode.commands.executeCommand("workbench.action.revertFile");
          await vscode.commands.executeCommand(
            "workbench.action.closeActiveEditor"
          );
        }

        // 🆕 Open a fresh preview doc
        const right = vscode.Uri.parse("untitled:RefactorPreview.java");

        const edit = new vscode.WorkspaceEdit();
        edit.insert(right, new vscode.Position(0, 0), patch.preview);
        await vscode.workspace.applyEdit(edit);

        await new Promise((resolve) => setTimeout(resolve, 100));

        // 💡 Show the diff preview
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          right,
          "AI Suggested Changes",
          { preview: true } // <--- Important: opens diff in preview mode
        );

        // 🧭 Ask user to apply or cancel
        const apply = await vscode.window.showQuickPick(
          ["Apply refactor", "Cancel"],
          { placeHolder: "Apply Extract Method?" }
        );
        if (apply !== "Apply refactor") return;

        // ✅ Close preview cleanly (no popup)
        const previewDoc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === "untitled:RefactorPreview.java"
        );
        if (previewDoc) {
          await vscode.window.showTextDocument(previewDoc, { preview: false });
          await vscode.commands.executeCommand("workbench.action.files.revert");
          await vscode.commands.executeCommand(
            "workbench.action.closeActiveEditor"
          );
        }
        // ✅ Apply the refactor to the real file
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

        // === RefactoringMiner verification is OPTIONAL ===
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
        // ================================================

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

  // ---- NEW: Dashboard ----
  const openDash = vscode.commands.registerCommand(
    "sustainadev.openDashboard",
    () => openDashboard(context)
  );

  context.subscriptions.push(runAnalyzer, analyzeActiveFile, openDash);
}

export function deactivate() {}
