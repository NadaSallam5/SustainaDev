import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { exec } from 'child_process';

// PoC flow
import { runLizard } from './analyzer/lizardRunner';
import { chooseRefactor } from './analyzer/smellClassifier';
import { buildExtractPatch } from './refactor/extractMethod';
import { buildExplanation } from './refactor/explanation';
import { gitCommit } from './git/commit';
import { verifyLastRefactor } from './git/refactoringMiner';

// energy + logging
import { initPaths, estimateEnergy } from './metrics/codeCarbon';
import { appendLog } from './metrics/logger';

type LizardFunction = {
  name: string;
  start: number; // 1-based line
  end: number;   // 1-based line
  ccn: number;
  nloc: number;
};
type LizardAnalysis = {
  functions: LizardFunction[];
};

export function activate(context: vscode.ExtensionContext) {
  console.log('🟢 SustainaDev Analyzer extension is active');
  initPaths(context); // ensure estimate.py resolves

  // ---- Run external Java analyzer (kept) ----
  const runAnalyzer = vscode.commands.registerCommand('sustainadev.runAnalyzer', () => {
    vscode.window.showInformationMessage('🚀 Running SustainaDev Java Analyzer...');

    // 👉 adjust these paths if needed
    const jarPath = path.join(
      'C:\\Users\\Dell\\Desktop\\SustainaDev\\target',
      'javatool-1.0-SNAPSHOT-jar-with-dependencies.jar'
    );
    const projectPath = 'C:\\Users\\Dell\\Desktop\\SustainaDev\\testcode';

    const command = `java -jar "${jarPath}" "${projectPath}"`;

    const terminal = vscode.window.createTerminal({ name: 'SustainaDev Analyzer' });
    terminal.show();
    terminal.sendText(command);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        vscode.window.showErrorMessage(`❌ Analyzer failed: ${error.message}`);
        return;
      }
      if (stderr) console.error(stderr);
      console.log(stdout);
      vscode.window.showInformationMessage('✅ Analysis complete! Check analysis-report.json');
    });
  });

  // ---- Analyze active file, refactor, commit, verify (optional), log ----
  const analyzeActiveFile = vscode.commands.registerCommand('sustainadev.analyzeActiveFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open a file to analyze.');
      return;
    }

    const cfg = vscode.workspace.getConfiguration('sustainadev');
    const useRM = cfg.get<boolean>('enableRefactoringMiner') === true;

    const originalUri = editor.document.uri;
    const filePath = originalUri.fsPath;

    let analysis: LizardAnalysis;
    try {
      analysis = (await runLizard(filePath)) as LizardAnalysis;
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message ?? String(e));
      return;
    }

    if (!analysis?.functions?.length) {
      vscode.window.showInformationMessage('No functions found.');
      return;
    }

    // choose the "worst" function
    const worst = [...analysis.functions].sort((a, b) => (b.ccn - a.ccn) || (b.nloc - a.nloc))[0];
    const decision = chooseRefactor(worst);
    if (decision.type !== 'Extract Method') {
      vscode.window.showInformationMessage('No actionable refactor (demo thresholds).');
      return;
    }

    // pick a safe middle slice
    const len = worst.end - worst.start + 1;
    const fromLine1Based = worst.start + Math.floor(len / 3);
    const toLine1Based = Math.min(worst.end, fromLine1Based + Math.min(10, Math.floor(len / 4)));

    const patch = buildExtractPatch(editor.document.getText(), {
      from: fromLine1Based,
      to: toLine1Based
    });

    // prepare an untitled preview document
    const right = vscode.Uri.parse('untitled:RefactorPreview.java');
    const previewDoc = await vscode.workspace.openTextDocument(right);
    const previewEdit = new vscode.WorkspaceEdit();
    previewEdit.insert(
      right,
      new vscode.Position(0, 0),
      `${patch.preview}\n\n${patch.newMethod}\n`
    );
    await vscode.workspace.applyEdit(previewEdit);
    await vscode.window.showTextDocument(previewDoc, { preview: true });
    await vscode.commands.executeCommand('vscode.diff', originalUri, right, 'Refactor Preview');

    const apply = await vscode.window.showQuickPick(['Apply refactor', 'Cancel'], {
      placeHolder: 'Apply Extract Method?'
    });
    if (apply !== 'Apply refactor') return;

    // ✅ apply changes safely on the original document
    const doc = await vscode.workspace.openTextDocument(originalUri);
    const we = new vscode.WorkspaceEdit();

    // Convert 1-based to 0-based for VS Code API
    const startLine = Math.max(fromLine1Based - 1, 0);
    const endLineExclusive = Math.min(toLine1Based, doc.lineCount - 1);

    const replaceRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLineExclusive + 1, 0) // +1 to include the line fully
    );

    we.replace(originalUri, replaceRange, `        extractedHelper();\n`);
    we.insert(originalUri, new vscode.Position(doc.lineCount, 0), `\n${patch.newMethod}\n`);

    const applied = await vscode.workspace.applyEdit(we);
    if (!applied) {
      vscode.window.showErrorMessage('Failed to apply refactor edits.');
      return;
    }
    const shown = await vscode.window.showTextDocument(doc, { preview: false });
    await shown.document.save();

    // re-run to get "after" metrics
    const after = (await runLizard(filePath)) as LizardAnalysis;
    const afterFn = after.functions.find((f) => f.name === worst.name) ?? worst;

    const explanation = buildExplanation(
      worst.name,
      { ccn: worst.ccn, nloc: worst.nloc },
      { ccn: afterFn.ccn, nloc: afterFn.nloc }
    );
    vscode.window.showInformationMessage(explanation);

    // commit (guard workspace existence)
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) {
      vscode.window.showWarningMessage('No workspace folder detected. Skipping commit and log steps.');
      return;
    }

    const msg = `Extract Method in ${worst.name}: CCN ${worst.ccn}→${afterFn.ccn}`;
    try {
      await gitCommit(ws, msg);
    } catch (e: any) {
      vscode.window.showWarningMessage(`Git commit failed: ${e?.message ?? e}`);
    }

    // OPTIONAL RefactoringMiner verification
    let verified = false;
    if (useRM) {
      try {
        const res = await verifyLastRefactor(ws);
        verified = Array.isArray(res) ? res.length > 0 : Boolean(res);
      } catch (e: any) {
        vscode.window.showWarningMessage(
          `RefactoringMiner verification failed; continuing without it. ${e?.message ?? ''}`.trim()
        );
      }
    } else {
      vscode.window.showInformationMessage('RefactoringMiner is disabled; skipping verification.');
    }

    // energy estimate
    const deltaCCN = Math.max(worst.ccn - afterFn.ccn, 0);
    const energy = await estimateEnergy(deltaCCN).catch(() => null);

    // log
    try {
      appendLog(ws, {
        timestamp: new Date().toISOString(),
        file: filePath,
        refactor: 'Extract Method',
        before: { ccn: worst.ccn, nloc: worst.nloc },
        after: { ccn: afterFn.ccn, nloc: afterFn.nloc },
        delta: { ccn: deltaCCN, nloc: worst.nloc - afterFn.nloc },
        verify: { refminer: verified },
        energy,
        commit: { message: msg }
      });
    } catch (e: any) {
      vscode.window.showWarningMessage(`Log append failed: ${e?.message ?? e}`);
    }

    vscode.window.showInformationMessage(
      'Refactor applied, committed, and logged.' + (useRM ? '' : ' (Verification skipped)')
    );
  });

  // ---- Dashboard (reads analysis-report.json and .sustainadev/log.jsonl) ----
  const openDash = vscode.commands.registerCommand('sustainadev.openDashboard', async () => {
    const panel = vscode.window.createWebviewPanel(
      'sustainadevDashboard',
      'SustainaDev Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
      }
    );

    // Load HTML from /media
    const dashboardPath = path.join(context.extensionPath, 'media', 'dashboard.html');
    let html = '';
    try {
      html = await fsp.readFile(dashboardPath, 'utf8');
    } catch (e: any) {
      html = `<html><body><h3>Dashboard error</h3><pre>${e?.message ?? e}</pre></body></html>`;
    }
    panel.webview.html = html;

    panel.webview.onDidReceiveMessage(
      async (message: any) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          if (message?.type === 'readAnalysis') {
            panel.webview.postMessage({ type: 'analysisError', error: 'No workspace folder open.' });
          }
          if (message?.type === 'readLog') {
            panel.webview.postMessage({ type: 'logError', error: 'No workspace folder open.' });
          }
          return;
        }
        const ws = workspaceFolder.uri.fsPath;

        // Legacy support for your earlier HTML that posts {type:'readFile'}
        if (message?.type === 'readFile') {
          try {
            const filePath = path.join(ws, 'analysis-report.json');
            const content = await fsp.readFile(filePath, 'utf8');
            panel.webview.postMessage({ type: 'fileContent', content });
          } catch (e: any) {
            panel.webview.postMessage({ type: 'fileError', error: e?.message ?? String(e) });
          }
        }

        if (message?.type === 'readAnalysis') {
          try {
            const filePath = path.join(ws, 'analysis-report.json');
            const content = await fsp.readFile(filePath, 'utf8');
            panel.webview.postMessage({ type: 'analysisContent', content });
          } catch (e: any) {
            panel.webview.postMessage({ type: 'analysisError', error: e?.message ?? String(e) });
          }
        }

        if (message?.type === 'readLog') {
          try {
            const logPath = path.join(ws, '.sustainadev', 'log.jsonl');
            if (!fs.existsSync(logPath)) {
              throw new Error('log.jsonl not found in .sustainadev/');
            }
            const raw = await fsp.readFile(logPath, 'utf8');
            const lines = raw.split(/\r?\n/).filter(Boolean);
            panel.webview.postMessage({ type: 'logContent', lines });
          } catch (e: any) {
            panel.webview.postMessage({ type: 'logError', error: e?.message ?? String(e) });
          }
        }
      },
      undefined,
      context.subscriptions
    );
  });

  context.subscriptions.push(runAnalyzer, analyzeActiveFile, openDash);
}

export function deactivate() {}
