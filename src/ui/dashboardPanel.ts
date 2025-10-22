import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function openDashboard(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel('sustainadevDashboard','SustainaDev Dashboard',vscode.ViewColumn.Beside,{enableScripts:true});
  const html = fs.readFileSync(path.join(context.extensionPath,'media','dashboard.html'),'utf8');
  panel.webview.html = html;

  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath!;
  const logPath = path.join(workspace,'.sustainadev','log.jsonl');

  function load() {
    const points = fs.existsSync(logPath) ? fs.readFileSync(logPath,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)) : [];
    panel.webview.postMessage({ type:'data', points });
  }
  panel.webview.onDidReceiveMessage(msg=>{ if (msg.type==='refresh') {load();} });
  load();
}
