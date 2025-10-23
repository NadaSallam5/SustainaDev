import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

let ESTIMATE_SCRIPT_PATH: string | undefined;

/**
 * Initialize the absolute path to estimate.py once when the extension activates.
 * Called from extension.ts → activate().
 */
export function initPaths(context: vscode.ExtensionContext) {
  // The script is inside your packaged extension (copied via webpack or manual).
  ESTIMATE_SCRIPT_PATH = context.asAbsolutePath(path.join('scripts', 'estimate.py'));
}

/** 
 * Choose a Python executable to run the energy estimation.
 * Priority:
 *  1. Environment variable PYTHON
 *  2. "python" (Windows)
 *  3. "python3" (Linux/macOS)
 */
function pickPython(): string {
  const envPy = process.env.PYTHON?.trim();
  if (envPy) return envPy;
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Runs the energy estimation script with the given number of lines changed.
 * Returns an estimated kWh (number), or undefined if the estimation failed.
 *
 * The Python script should accept a single numeric argument (lines changed)
 * and print a floating-point value to stdout.
 */
export async function estimateEnergy(linesChanged: number): Promise<number | undefined> {
  try {
    // Fallback defensive path if initPaths() was never called
    const scriptPath =
      ESTIMATE_SCRIPT_PATH ??
      path.join(__dirname, '..', '..', 'scripts', 'estimate.py');

    const py = pickPython();

    return await new Promise<number | undefined>((resolve) => {
      execFile(
        py,
        [scriptPath, String(linesChanged)],
        { cwd: path.dirname(scriptPath) },
        (err, stdout, stderr) => {
          if (err) {
            console.warn(`⚠️ Energy estimate skipped: ${err.message}\n${stderr ?? ''}`);
            return resolve(undefined);
          }

          const value = parseFloat(String(stdout).trim());
          resolve(Number.isFinite(value) ? value : undefined);
        }
      );
    });
  } catch (e: any) {
    console.warn(`⚠️ Energy estimate unavailable: ${e?.message ?? e}`);
    return undefined;
  }
}
