import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

let EXT_ROOT: vscode.Uri;

export function initPaths(context: vscode.ExtensionContext) {
  EXT_ROOT = context.extensionUri;
}

function pickPython(): string {
  // If the user set PYTHON, honor it first.
  if (process.env.PYTHON && process.env.PYTHON.trim()) return process.env.PYTHON;

  // Windows often has "py"; otherwise "python". Non-Win prefers "python3".
  if (process.platform === 'win32') return 'python'; // or 'py' if you prefer the launcher
  return 'python3';
}

export async function estimateEnergy(linesChanged: number): Promise<number | undefined> {
  try {
    const scriptPath = vscode.Uri.joinPath(EXT_ROOT, 'metrics', 'estimate.py').fsPath;
    const py = pickPython();

    return await new Promise((resolve) => {
      execFile(py, [scriptPath, String(linesChanged)], { cwd: path.dirname(scriptPath) },
        (err, stdout, stderr) => {
          if (err) {
            console.warn(`⚠️ Energy estimate skipped: ${err.message}\n${stderr ?? ''}`);
            return resolve(undefined);
          }
          const n = parseFloat(String(stdout).trim());
          resolve(Number.isFinite(n) ? n : undefined);
        });
    });
  } catch (e: any) {
    console.warn(`⚠️ Energy estimate unavailable: ${e.message}`);
    return undefined;
  }
}
