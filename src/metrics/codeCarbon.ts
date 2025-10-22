import * as cp from "child_process";
import * as path from "path";
import * as vscode from "vscode";

export type Energy = {
  emissions_kg: number;
  estimated_kwh_saved: number;
  estimated_cost_saved_usd: number;
};

export async function estimateEnergy(deltaComplexity: number): Promise<Energy> {
  return new Promise((res, rej) => {
    try {
      // ✅ Get absolute path to your extension
      const ext = vscode.extensions.getExtension("sustainadev.sustainadev");
      if (!ext)
        return rej(new Error("Extension not found (sustainadev.sustainadev)."));

      // ✅ Build correct full path to metrics/estimate.py
      const scriptPath = path.join(ext.extensionPath, "metrics", "estimate.py");
      console.log("🧭 Running Python script at:", scriptPath);

      // ✅ Execute Python script safely
      const command = `python "${scriptPath}" ${deltaComplexity}`;
      cp.exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error("Python error:", stderr);
          return rej(new Error(stderr || error.message));
        }

        try {
          const result = JSON.parse(stdout);
          res(result);
        } catch (parseErr) {
          rej(new Error("Failed to parse Python output: " + stdout));
        }
      });
    } catch (err) {
      rej(err);
    }
  });
}

// import * as cp from 'child_process';
// export type Energy = { emissions_kg:number; estimated_kwh_saved:number; estimated_cost_saved_usd:number };
// export async function estimateEnergy(deltaComplexity: number): Promise<Energy> {
//   return new Promise((res, rej) => {
//     cp.exec(`python metrics/estimate.py ${deltaComplexity}`, (e, stdout) => {
//       if (e) return rej(e);
//       try { res(JSON.parse(stdout)); } catch (err) { rej(err); }
//     });
//   });
// }
