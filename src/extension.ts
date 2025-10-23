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

        // Setting gate: turn RM on/off in settings (default false in package.json)
        const cfg = vscode.workspace.getConfiguration("sustainadev");
        const useRM = cfg.get<boolean>("enableRefactoringMiner") === true;

        const originalUri = editor.document.uri; // keep a handle to the original document
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

        /*  // pick a middle slice of the method (PoC-safe)
      const len = worst.end - worst.start + 1;
      const from = worst.start + Math.floor(len / 3);
      const to = Math.min(worst.end, from + Math.min(10, Math.floor(len / 4)));
 */

        const fullCode = refreshedDoc.getText();
        const fullCodeLines = fullCode.split(/\r?\n/);

        if (worst.end > fullCodeLines.length) {
          vscode.window.showErrorMessage(
            "Refactor range invalid after update."
          );
          return;
        }

        const classMatches = fullCode.match(/\bclass\s+\w+/g) || [];
        console.log("🧩 Classes detected:", classMatches);
        vscode.window.showInformationMessage(
          `Analyzing ${classMatches.join(", ")}`
        );

        // NEW: Just pass the entire method range
        const patch = await buildExtractPatch(
          fullCode,
          {
            from: worst.start,
            to: worst.end,
          },
          path.basename(filePath)
        );

        // 🧹 Clean duplicate classes in AI preview
        // ✅ Validate AI output before showing preview
        if ((patch.preview.match(/\bclass\s+\w+/g) || []).length > 1) {
          vscode.window.showWarningMessage(
            "⚠️ AI returned multiple classes — trimming to the first one."
          );
          const firstEnd =
            patch.preview.indexOf("}", patch.preview.indexOf("class ")) + 1;
          patch.preview = patch.preview.slice(0, firstEnd);
        }

        // preview (diff)
        const right = vscode.Uri.parse("untitled:RefactorPreview.java");
        await vscode.workspace.openTextDocument(right); // ensure it exists

        const previewEdit = new vscode.WorkspaceEdit();
        previewEdit.insert(
          right,
          new vscode.Position(0, 0),
          patch.preview // ✅ Just use the preview - it already has everything!
        );

        await vscode.workspace.applyEdit(previewEdit);
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          right,
          "Refactor Preview"
        );

        const apply = await vscode.window.showQuickPick(
          ["Apply refactor", "Cancel"],
          { placeHolder: "Apply Extract Method?" }
        );
        if (apply !== "Apply refactor") return;

        // ✅ Apply the refactored code (AI already did all the work!)
        const doc = await vscode.workspace.openTextDocument(originalUri);
        const we = new vscode.WorkspaceEdit();

        // Replace entire document
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(doc.lineCount, 0)
        );

        we.replace(originalUri, fullRange, patch.preview);

        const applied = await vscode.workspace.applyEdit(we);
        if (!applied) {
          vscode.window.showErrorMessage("Failed to apply refactor edits.");
          return;
        }

        await vscode.commands.executeCommand("editor.action.formatDocument");
        await vscode.window.showTextDocument(doc, { preview: false });
        await doc.save();

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
