import * as vscode from "vscode";
import * as path from "path";
import { buildOptimizationReport } from "../business/complexity/report";


import * as fsp from "fs/promises";

// Project internal imports

import {
  buildOptimizationPatch,
  logOptimizationFromReport,
} from "../business/refactor/optimizeComplexity";
import { chooseRefactor } from "../business/refactor/chooseRefactor";
import { initPaths } from "../business/codeCarbon";
import { runJavaAnalyzer } from "../business/analyzer/javaRunner";
import si from "systeminformation";

/**
 * Global state to prevent concurrent executions
 */
let isRunning = false;
export let sustainaDevOutput: vscode.OutputChannel;

const validSmells = [
  "RECURSION",
  "NESTED_LOOPS",
  "GENERAL",
  "SORTING_IN_LOOP",
  "SORTING",
  "STRING_CONCAT",
];
/**
 * SustainaDev Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");
sustainaDevOutput = vscode.window.createOutputChannel("SustainaDev");
sustainaDevOutput.appendLine("SustainaDev activated ✅");

  // 1. Register Analyzer Command
 

  // 2. Register Active File Analysis Command
  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    () => executeAnalyzeActiveFile(context),
  );

  // 3. Register Dashboard Command
  const openDash = vscode.commands.registerCommand(
    "sustainadev.openDashboard",
    () => executeOpenDashboard(context),
  );
const getSpecs = vscode.commands.registerCommand(
    "sustainadev.getSpecs",
    async () => {
      vscode.window.showInformationMessage("🔍 Collecting system specs...");

      try {
        const cpu = await si.cpu();
        const gpu = await si.graphics();
        const mem = await si.mem();
        const os = await si.osInfo();
        const disks = await si.diskLayout();
        const battery = await si.battery();
        const gpuModel =
          gpu.controllers && gpu.controllers.length > 0
            ? gpu.controllers[0].model
            : "No GPU detected";
        const diskInfo = disks
  .map((d, index) => {
    const sizeGB = (d.size / 1024 / 1024 / 1024).toFixed(1);
    const type = d.type || "Unknown";
    const name = d.name || d.vendor || "Disk " + (index + 1);

    return `• ${type} • ${name} • ${sizeGB} GB`;
  })
  .join("\n");

     const batteryInfo = battery.hasBattery
  ? `Health: ${
      battery.designedCapacity && battery.maxCapacity
        ? ((battery.maxCapacity / battery.designedCapacity) * 100).toFixed(0)
        : "N/A"
    }% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
  : "No battery detected";

       const msg = await collectHardwareSpecsMarkdown();
vscode.window.showInformationMessage(msg, { modal: true });

      } catch (err: any) {
        vscode.window.showErrorMessage("❌ Failed to read system specs: " + err.message);
      }
    }
  );
  context.subscriptions.push( analyzeActiveFile, openDash, getSpecs);
}

export function deactivate() {}

/* =========================================================================
   COMMAND IMPLEMENTATIONS
   ========================================================================= */

/**
 * Logic for 'sustainadev.runAnalyzer'
 */


/**
 * Logic for 'sustainadev.analyzeActiveFile'
 */
async function executeAnalyzeActiveFile(context: vscode.ExtensionContext) {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes.",
    );
    return;
  }

  isRunning = true;
  vscode.window.showInformationMessage("🚀 SustainaDev pipeline started...");

  try {
    initPaths(context);

    // 1. Validation & Setup
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.isDirty) {
      await editor.document.save();
    }
    if (!editor) {
      isRunning = false;
      return;
    }

    const originalUri = editor.document.uri;
    const filePath = originalUri.fsPath;
    const refreshedDoc = await vscode.workspace.openTextDocument(originalUri);
    await refreshedDoc.save();

const fullCode = refreshedDoc.getText();

const factsList = await runJavaAnalyzer(context);

if (!factsList.length) {
  vscode.window.showInformationMessage("No methods detected by analyzer.");
  isRunning = false;
  return;
}


// OPTIONAL: choose one method (first or highest complexity later)
const facts =
  factsList.find(m => m.sortInsideLoop === true) ||
  factsList.find(m => m.hasSortingCall === true) ||
  factsList[0];
// 🔥 RULE ENGINE (WHAT to do)
const decision = chooseRefactor(facts);

    // 3. Execution Logic
    if (validSmells.includes(decision.type)) {
     const patch = await buildOptimizationPatch(
  fullCode,
  {
    from: editor.selection.start.line,
    to: editor.selection.end.line,
  },
  filePath,
  {
    targetMethodName: facts.methodName,
    smellType: decision.type,
    methodFacts: facts, // ✅ REQUIRED
  }
);

void vscode.window.showQuickPick(
  ["✅ Accept Optimization", "❌ Reject"],
  {
    placeHolder: "Apply the optimized code?",
  }
).then(async (choice) => {
if (choice === "✅ Accept Optimization") {
  await applyPatchToDocument(
    originalUri,
    patch.preview,
    refreshedDoc.lineCount
  );

  await refreshedDoc.save();

  vscode.window.showInformationMessage("✅ Optimization applied successfully.");

  // ✅ Run analyzer AFTER applying patch
  const afterFactsList = await runJavaAnalyzer(context);
  const afterFacts = afterFactsList.find(m => m.methodName === facts.methodName);

 if (afterFacts) {
   const report = buildOptimizationReport(facts, afterFacts);

const title =
  report.metric === "space"
    ? "=== Space Complexity Report ==="
    : "=== Complexity Report ===";

const label =
  report.metric === "space" ? "Space" : "Before";

sustainaDevOutput.appendLine(title);

if (report.metric === "space") {
  sustainaDevOutput.appendLine(`Space Before: ${report.before}`);
  sustainaDevOutput.appendLine(`Space After:  ${report.after}`);
} else {
  sustainaDevOutput.appendLine(`Before: ${report.before}`);
  sustainaDevOutput.appendLine(`After:  ${report.after}`);
}

sustainaDevOutput.appendLine(`Improvement: ${report.improvement}`);

vscode.window.showInformationMessage(
  report.metric === "space"
    ? `Space improved: ${report.before} → ${report.after}`
    : `Complexity improved: ${report.before} → ${report.after}`
);


    vscode.window.showInformationMessage(
      `Complexity improved: ${report.before} → ${report.after}`
    );
    const workspace =
  vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

await logOptimizationFromReport(
  workspace,
  filePath,        // full path is ok; logger uses basename anyway
  report,          // <-- SAME report you printed in console
  patch.reason     // <-- same reason you already have
);

}
 else {
    sustainaDevOutput.appendLine(
      `⚠️ Could not find AFTER facts for method: ${facts.methodName}`
    );
  }
}
 else if (choice) {
    vscode.window.showInformationMessage(
      "❌ Optimization discarded."
    );
  }
});


    } else {
      vscode.window.showInformationMessage("No actionable refactor suggested.");
    }
  } catch (err: any) {
    // 🛡️ Graceful Handling for ALREADY_OPTIMIZED
    if (err.message === "ALREADY_OPTIMIZED") {
      isRunning = false;
      return;
    }
    vscode.window.showErrorMessage(
      `❌ SustainaDev failed: ${err.message || err}`,
    );
  } finally {
    isRunning = false;
    vscode.window.showInformationMessage(
      "🟢 SustainaDev pipeline ready for next run.",
    );
  }
}

/**
 * Helper to handle the specific optimization workflow
 */

/**
 * Logic for 'sustainadev.openDashboard'
 */
async function executeOpenDashboard(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "sustainadevDashboard",
    "SustainaDev Dashboard",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(
          path.join(
            context.extensionPath,
            "src",
            "presentation",
            "media"
          )
        ),
      ],
    }
  );

  const dashboardPath = path.join(
    context.extensionPath,
    "src",
    "presentation",
    "media",
    "dashboard.html"
  );

  try {
    const html = await fsp.readFile(dashboardPath, "utf8");
    panel.webview.html = html;
  } catch (e: any) {
    panel.webview.html = `
      <html>
        <body>
          <h3>Dashboard error</h3>
          <pre>${e?.message ?? e}</pre>
        </body>
      </html>`;
  }

  // Message Handling (this part was already correct)
  panel.webview.onDidReceiveMessage(
    async (message: any) => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const ws = workspaceFolder.uri.fsPath;

      if (message?.type === "readAnalysis") {
        await handleReadAnalysis(panel, ws);
      } else if (message?.type === "readLog") {
        await handleReadLog(panel, ws);
      } else if (message?.type === "readHardware") {
        await handleReadHardware(panel);
      }
      else if (message?.type === "getSpecs") {
  try {
    const content = await collectHardwareSpecsMarkdown();
    panel.webview.postMessage({ type: "specsContent", content });
  } catch (e: any) {
    panel.webview.postMessage({
      type: "specsError",
      error: e?.message ?? String(e),
    });
  }
}

    },
    undefined,
    context.subscriptions
  );
}


/* =========================================================================
   HELPER FUNCTIONS
   ========================================================================= */

async function closeExistingPreview(uriStringPartial: string) {
  const oldDoc = vscode.workspace.textDocuments.find((d) =>
    d.uri.toString().includes(uriStringPartial),
  );
  if (oldDoc) {
    // Attempt to show it so we can close it, or check visible editors
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document === oldDoc,
    );
    if (editor) {
      await vscode.window.showTextDocument(oldDoc, {
        preview: false,
        preserveFocus: false,
      });
      await vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
    }
  }
}

async function createAndShowPreview(
  previewUri: vscode.Uri,
  content: string,
  originalUri: vscode.Uri,
) {
  const edit = new vscode.WorkspaceEdit();
  edit.insert(previewUri, new vscode.Position(0, 0), content);
  await vscode.workspace.applyEdit(edit);

  // Wait briefly for FS update
  await new Promise((resolve) => setTimeout(resolve, 200));

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalUri,
    previewUri,
    "🔄 SustainaDev: Algorithmic Optimization (Original ← → Optimized)",
    { preview: true },
  );
}

async function applyPatchToDocument(
  uri: vscode.Uri,
  content: string,
  lineCount: number,
) {
  const we = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    new vscode.Position(lineCount, 0),
  );
  we.replace(uri, fullRange, content);

  const applied = await vscode.workspace.applyEdit(we);
  if (!applied) {
    throw new Error("Failed to apply optimization edits.");
  }

  await vscode.commands.executeCommand("editor.action.formatDocument");
  await vscode.window.showTextDocument(uri, { preview: false });
}

async function handleReadAnalysis(panel: vscode.WebviewPanel, ws: string) {
  try {
    const content = await fsp.readFile(
      path.join(ws, "analysis-report.json"),
      "utf8",
    );
    panel.webview.postMessage({ type: "analysisContent", content });
  } catch (e: any) {
    panel.webview.postMessage({
      type: "analysisError",
      error: e?.message ?? String(e),
    });
  }
}

async function handleReadLog(panel: vscode.WebviewPanel, ws: string) {
  try {
    const logPath = path.join(ws, ".sustainadev", "log.jsonl");
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
async function collectHardwareSpecsMarkdown(): Promise<string> {
  const cpu = await si.cpu();
  const gpu = await si.graphics();
  const mem = await si.mem();
  const os = await si.osInfo();
  const disks = await si.diskLayout();
  const battery = await si.battery();

  const gpuModel =
    gpu.controllers && gpu.controllers.length > 0
      ? gpu.controllers[0].model
      : "No GPU detected";

  const diskInfo = disks
    .map((d, index) => {
      const sizeGB = (d.size / 1024 / 1024 / 1024).toFixed(1);
      const type = d.type || "Unknown";
      const name = d.name || d.vendor || `Disk ${index + 1}`;
      return `• ${type} • ${name} • ${sizeGB} GB`;
    })
    .join("\n");

  const batteryInfo = battery.hasBattery
    ? `Health: ${
        battery.designedCapacity && battery.maxCapacity
          ? ((battery.maxCapacity / battery.designedCapacity) * 100).toFixed(0)
          : "N/A"
      }% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
    : "No battery detected";

  return `💻 System Specifications

🧠 CPU: ${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)
🎮 GPU: ${gpuModel}
📦 RAM: ${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB
🖥️ OS: ${os.distro} (${os.arch})

💽 Disks:
${diskInfo || "No disk info"}

🔋 Battery:
${batteryInfo}
`;
}


async function handleReadHardware(panel: vscode.WebviewPanel) {
  try {
    console.log("🔍 Starting hardware collection...");
    const specs = await collectHardwareSpecsForDashboard();
    console.log("✅ Hardware collection successful");
    panel.webview.postMessage({ type: "hardwareContent", specs });
  } catch (e: any) {
    console.error("❌ Hardware specs error:", e);
    panel.webview.postMessage({
      type: "hardwareError",
      error: e?.message ?? String(e),
    });
  }
}

async function collectHardwareSpecsForDashboard(): Promise<{
  cpu: string;
  gpu: string;
  ram: string;
  os: string;
  disks: string;
  battery: string;
}> {
  let cpuInfo = "Loading...";
  let gpuModel = "Loading...";
  let ramGB = "Loading...";
  let osString = "Loading...";
  let diskInfo = "Loading...";
  let batteryInfo = "Loading...";

  // Collect each hardware component separately with timeout and error handling
  try {
    console.log("  → Getting CPU info...");
    const cpuPromise = si.cpu();
    const cpu = await Promise.race([
      cpuPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("CPU timeout")), 5000))
    ]);
    cpuInfo = `${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)`;
    console.log("  ✓ CPU info collected");
  } catch (e: any) {
    cpuInfo = "Error loading CPU info";
    console.error("  ✗ CPU error:", e?.message);
  }

  try {
    console.log("  → Getting GPU info...");
    const gpuPromise = si.graphics();
    const gpu = await Promise.race([
      gpuPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("GPU timeout")), 5000))
    ]);
    gpuModel = gpu.controllers && gpu.controllers.length > 0
      ? gpu.controllers[0].model
      : "No GPU detected";
    console.log("  ✓ GPU info collected");
  } catch (e: any) {
    gpuModel = "Error loading GPU info";
    console.error("  ✗ GPU error:", e?.message);
  }

  try {
    console.log("  → Getting RAM info...");
    const memPromise = si.mem();
    const mem = await Promise.race([
      memPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("RAM timeout")), 5000))
    ]);
    ramGB = `${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB`;
    console.log("  ✓ RAM info collected");
  } catch (e: any) {
    ramGB = "Error loading RAM info";
    console.error("  ✗ RAM error:", e?.message);
  }

  try {
    console.log("  → Getting OS info...");
    const osPromise = si.osInfo();
    const osInfo = await Promise.race([
      osPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("OS timeout")), 5000))
    ]);
    osString = `${osInfo.distro} (${osInfo.arch})`;
    console.log("  ✓ OS info collected");
  } catch (e: any) {
    osString = "Error loading OS info";
    console.error("  ✗ OS error:", e?.message);
  }

  try {
    console.log("  → Getting disk info...");
    const diskPromise = si.diskLayout();
    const disks = await Promise.race([
      diskPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Disk timeout")), 5000))
    ]);
    diskInfo = disks
      .map((d: any, index: number) => {
        const sizeGB = d.size ? (d.size / 1024 / 1024 / 1024).toFixed(1) : "0";
        const type = d.type || "Unknown";
        const name = d.name || d.vendor || `Disk ${index + 1}`;
        return `• ${type} • ${name} • ${sizeGB} GB`;
      })
      .join("\n") || "No disks detected";
    console.log("  ✓ Disk info collected");
  } catch (e: any) {
    diskInfo = "Error loading disk info";
    console.error("  ✗ Disk error:", e?.message);
  }

  try {
    console.log("  → Getting battery info...");
    const batteryPromise = si.battery();
    const battery = await Promise.race([
      batteryPromise,
      new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Battery timeout")), 5000))
    ]);
    batteryInfo = battery.hasBattery
      ? `Health: ${
          battery.designedCapacity && battery.maxCapacity
            ? ((battery.maxCapacity / battery.designedCapacity) * 100).toFixed(0)
            : "N/A"
        }% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
      : "No battery detected";
    console.log("  ✓ Battery info collected");
  } catch (e: any) {
    batteryInfo = "Error loading battery info";
    console.error("  ✗ Battery error:", e?.message);
  }

  console.log("✅ All hardware info collection complete");
  return {
    cpu: cpuInfo,
    gpu: gpuModel,
    ram: ramGB,
    os: osString,
    disks: diskInfo,
    battery: batteryInfo,
  };
}