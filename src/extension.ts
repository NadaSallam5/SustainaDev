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
        if (!editor) {
          vscode.window.showWarningMessage("No active editor found.");
          return;
        }

        // Setting gate: turn RM on/off in settings
        const cfg = vscode.workspace.getConfiguration("sustainadev");
        const useRM = cfg.get<boolean>("enableRefactoringMiner") === true;

        const originalUri = editor.document.uri;
        const filePath = originalUri.fsPath;

        // Save current document if it has unsaved changes
        if (editor.document.isDirty) {
          await editor.document.save();
        }

        // Run Lizard analysis
        const analysis = await runLizard(filePath);
        if (!analysis.functions.length) {
          vscode.window.showInformationMessage("No functions found.");
          return;
        }

        // Find worst function
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

        // Get fresh document content
        const currentDoc = await vscode.workspace.openTextDocument(originalUri);
        const fullCode = currentDoc.getText();

        // Generate refactoring patch
        const patch = await buildExtractPatch(
          fullCode,
          {
            from: worst.start,
            to: worst.end,
          },
          path.basename(filePath)
        );

        // 🧹 Close any old preview tab if it exists
        const previewUriString = "untitled:RefactorPreview.java";
        const oldDoc = vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === previewUriString
        );

        if (oldDoc) {
          // Close all tabs showing this preview
          const tabs = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .filter(
              (tab) =>
                tab.input instanceof vscode.TabInputText &&
                tab.input.uri.toString() === previewUriString
            );

          for (const tab of tabs) {
            await vscode.window.tabGroups.close(tab);
          }
        }

        // 🆕 Create a fresh in-memory preview document
        const previewUri = vscode.Uri.parse(previewUriString);
        const previewDoc = await vscode.workspace.openTextDocument(previewUri);

        const previewEdit = new vscode.WorkspaceEdit();
        previewEdit.replace(
          previewUri,
          new vscode.Range(0, 0, previewDoc.lineCount, 0),
          patch.preview
        );

        const previewSuccess = await vscode.workspace.applyEdit(previewEdit);
        if (!previewSuccess) {
          vscode.window.showErrorMessage("Failed to create preview.");
          return;
        }

        // 🕒 Wait briefly to ensure VS Code syncs buffer
        await new Promise((resolve) => setTimeout(resolve, 100));

        // 🖥️ Open the side-by-side diff view
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          previewUri,
          "Refactor Preview"
        );

        // 🧭 Ask user whether to apply
        const apply = await vscode.window.showQuickPick(
          ["Apply refactor", "Cancel"],
          {
            placeHolder: "Apply Extract Method?",
          }
        );

        if (apply !== "Apply refactor") {
          // Close diff and preview
          await vscode.commands.executeCommand(
            "workbench.action.closeAllEditors"
          );
          // Re-open original file
          await vscode.window.showTextDocument(originalUri, { preview: false });
          vscode.window.showInformationMessage("Refactor cancelled.");
          return;
        }

        // ✅ Apply refactor to original file
        // Get the latest document state
        const docToEdit = await vscode.workspace.openTextDocument(originalUri);

        const applyEdit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(docToEdit.lineCount, 0)
        );

        applyEdit.replace(originalUri, fullRange, patch.preview);
        const applied = await vscode.workspace.applyEdit(applyEdit);

        if (!applied) {
          vscode.window.showErrorMessage("Failed to apply refactor edits.");
          return;
        }

        // 🎯 Close preview and refocus original file
        // Close all editors (diff + preview)
        await vscode.commands.executeCommand(
          "workbench.action.closeAllEditors"
        );

        // Re-open and show the refactored file
        const refactoredDoc = await vscode.workspace.openTextDocument(
          originalUri
        );
        await vscode.window.showTextDocument(refactoredDoc, {
          preview: false,
        });

        // Format document (with error handling)
        try {
          await vscode.commands.executeCommand("editor.action.formatDocument");
          // Wait for formatting to complete
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (error) {
          console.warn("Formatting failed:", error);
          // Continue without formatting
        }

        // Save the document
        await refactoredDoc.save();

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
