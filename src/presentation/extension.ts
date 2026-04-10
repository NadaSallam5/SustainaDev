import * as vscode from "vscode";
import * as path from "path";

import { extractFeatures } from "../business/analyzer/featureExtractor";
import { detectByRules } from "../business/refactor/ruleEngine";

import * as fsp from "fs/promises";
import * as fs from "fs";

// Project internal imports
import { buildOptimizationReport } from "../business/complexity/report";
import { analyzeSustainability } from "../business/sustainability/sustainabilityEngine";
import {
  buildOptimizationPatch,
  logOptimizationFromReport,
} from "../business/refactor/optimizeComplexity";
import { chooseRefactor } from "../business/refactor/chooseRefactor";
import { initPaths, startCpuSampling } from "../business/codeCarbon";

import { initPaths } from "../business/codeCarbon";
import { getAnalyzer, isLanguageSupported } from "../business/analyzer/analyzerFactory";
import { UnsupportedLanguageError } from "../business/analyzer/analyzerTypes";
import si from "systeminformation";
import { parseCode } from "../business/parser/astParser";

/**
 * Global state to prevent concurrent executions
 */
let isRunning = false;
export let sustainaDevOutput: vscode.OutputChannel;

const validSmells = [
  "ITERATIVE_REWRITE",
  "RECURSION",
  "NESTED_LOOPS",
  "GENERAL",
  "SORTING_IN_LOOP",
  "SORTING",
  "STRING_BUILDER",
  "MEMOIZATION",
  "STRING_CONCAT",
];
/**
 * SustainaDev Extension Activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");
  sustainaDevOutput = vscode.window.createOutputChannel("SustainaDev");
  sustainaDevOutput.appendLine("SustainaDev activated ✅");

  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    () => executeAnalyzeActiveFile(context),
  );

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
          ? `Health: ${battery.designedCapacity && battery.maxCapacity
            ? ((battery.maxCapacity / battery.designedCapacity) * 100).toFixed(0)
            : "N/A"
          }% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
          : "No battery detected";

        const msg = await collectHardwareSpecsMarkdown();
        vscode.window.showInformationMessage(msg, { modal: true });

      } catch (err: any) {
        vscode.window.showErrorMessage(
          "❌ Failed to read system specs: " + err.message,
        );
      }
    },
  );
  context.subscriptions.push(analyzeActiveFile, openDash, getSpecs);
}

export function deactivate() { }


async function executeAnalyzeActiveFile(context: vscode.ExtensionContext) {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes.",
    );
    return;
  }

  isRunning = true;
  initPaths(context);

  vscode.window.showInformationMessage("🚀 SustainaDev pipeline started...");

  try {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.isDirty) {
      await editor.document.save();
    }
    if (!editor) {
      isRunning = false;
      return;
    }

    // Language gate — friendly message for unsupported languages
    const languageId = editor.document.languageId;
    if (!isLanguageSupported(languageId)) {
      vscode.window.showInformationMessage(
        `SustainaDev: "${languageId}" is not yet supported. ` +
        `Java is fully supported. Python and JavaScript support is coming soon (Tree-sitter).`
      );
      isRunning = false;
      return;
    }

    // Get the correct analyzer for the active language
    const analyzer = getAnalyzer(languageId);

    const originalUri = editor.document.uri;
    const filePath = originalUri.fsPath;
    const refreshedDoc = await vscode.workspace.openTextDocument(originalUri);
    await refreshedDoc.save();

    const fullCode = refreshedDoc.getText();

    // STEP 1 — detect method name by walking backwards from cursor
    const cursorLine = editor.selection.active.line;
    const lines = fullCode.split(/\r?\n/);
    let targetMethodName: string | undefined;
    const factsList = await analyzer.analyzeFile(context);

    for (let i = cursorLine; i >= 0; i--) {
      const match = lines[i].match(
        /(?:public|private|protected|static|\s)+\w+\s+(\w+)\s*\([^)]*\)\s*\{/,
      );
      if (match) {
        targetMethodName = match[1];
        break;
      }
    }

    sustainaDevOutput.appendLine(
      `🎯 Detected method: ${targetMethodName ?? "NOT FOUND"}`,
    );
    const tree = parseCode(fullCode, filePath);
    const features = extractFeatures(tree.rootNode, targetMethodName);
    sustainaDevOutput.appendLine("=== FEATURES ===");
    sustainaDevOutput.appendLine(JSON.stringify(features, null, 2));

    // STEP 2 — build facts
    const facts = {
      methodName: targetMethodName ?? path.basename(filePath),
      callsSelf: features.recursion,
      maxLoopDepth: features.loopDepth,
      cyclomaticComplexity: 1,
      isLinearRecursion: false,
      isPureAccumulation: false,
      hasOverlappingSubproblems: false,
      hasStringConcatInLoop: features.stringConcatInLoop,
      hasSortingCall: features.sortingCalls > 0,
      sortInsideLoop: features.sortingInsideLoop,
    };

    // STEP 3 — Rule Engine
    const ruleDecision = detectByRules(features);
    let decision;

    if (ruleDecision) {
      decision = { type: ruleDecision };
      sustainaDevOutput.appendLine(`⚡ Rule decision: ${ruleDecision}`);
    } else {
      decision = chooseRefactor(facts);
      sustainaDevOutput.appendLine(`🤖 AI fallback: ${decision.type}`);
    }

    if (!decision || !decision.type) {
      sustainaDevOutput.appendLine("❌ No decision made.");
      vscode.window.showInformationMessage("No decision made.");
      isRunning = false;
      return;
    }

    // Choose the most actionable method:
    // Priority: sorting-in-loop > nested loops > string concat > sorting > first method
    const facts =
      factsList.find(m => m.sortInsideLoop === true) ||
      factsList.find(m => m.maxLoopDepth >= 2) ||
      factsList.find(m => m.hasStringConcatInLoop === true) ||
      factsList.find(m => m.hasSortingCall === true) ||
      factsList[0];

    // Rule engine — decide what to do
    const decision = chooseRefactor(facts);

    // 3. Execution Logic
    if (validSmells.includes(decision.type)) {
      const patch = await buildOptimizationPatch(
        refreshedDoc,
        {
          from: editor.selection.start.line,
          to: editor.selection.end.line,
        },
        filePath,
        {
          targetMethodName: facts.methodName,
          smellType: decision.type,
          methodFacts: facts,
        },
        analyzer,
      );

      void vscode.window
        .showQuickPick(["✅ Accept Optimization", "❌ Reject"], {
          placeHolder: "Apply the optimized code?",
          ignoreFocusOut: true,
        })
        .then(async (choice) => {
          if (choice === "✅ Accept Optimization") {
            await applyPatchToDocument(
              originalUri,
              patch.preview,
              refreshedDoc.lineCount,
            );
        }
      ).then(async (choice) => {
        // Proactive cleanup: 1. Close the tab, 2. Delete the file
        if (patch.previewUri) {
          try {
            await closeExistingPreview(patch.previewUri);
            if (fs.existsSync(patch.previewUri)) {
              await fsp.unlink(patch.previewUri);
            }
            console.log(`🧹 Proactive cleanup: ${patch.previewUri}`);
          } catch (e) {
            console.warn(`⚠️ Failed to cleanup preview file: ${patch.previewUri}`, e);
          }
        }

        if (choice === "✅ Accept Optimization") {
          await applyPatchToDocument(
            originalUri,
            patch.preview
          );

            sustainaDevOutput.appendLine(
              "✅ Optimization applied (Tree-sitter mode)",
            );

            // Build report from facts directly (Tree-sitter mode, no Java analyzer)
            const beforeFacts = facts;

            const optimizedTree = parseCode(patch.preview, filePath);
            const afterFeatures = extractFeatures(optimizedTree.rootNode, targetMethodName);

            const afterFacts = {
              methodName: targetMethodName ?? path.basename(filePath),
              callsSelf: afterFeatures.recursion,
              maxLoopDepth: afterFeatures.loopDepth,
              cyclomaticComplexity: 1,
              isLinearRecursion: false,
              isPureAccumulation: false,
              hasOverlappingSubproblems: false,
              hasStringConcatInLoop: afterFeatures.stringConcatInLoop,
              hasSortingCall: afterFeatures.sortingCalls > 0,
              sortInsideLoop: afterFeatures.sortingInsideLoop,
            };

            const report = buildOptimizationReport(beforeFacts, afterFacts);

            sustainaDevOutput.appendLine(
              report.metric === "space"
                ? "=== Space Complexity Report ==="
                : "=== Complexity Report ===",
            );

            if (report.metric === "space") {
              sustainaDevOutput.appendLine(`Space Before: ${report.before}`);
              sustainaDevOutput.appendLine(`Space After:  ${report.after}`);
            } else {
              sustainaDevOutput.appendLine(`Before: ${report.before}`);
              sustainaDevOutput.appendLine(`After:  ${report.after}`);
            }

            sustainaDevOutput.appendLine(`Improvement: ${report.improvement}`);

            // ─── Sustainability block ───
            let sustainabilityResult:
              | {
                  energyKwh: number;
                  carbonGrams: number;
                  beforeEnergyKwh: number;
                  beforeCarbonGrams: number;
                }
              | undefined;

            try {
              sustainaDevOutput.appendLine(
                "Running sustainability analysis...",
              );

              // BEFORE: fresh sample window on the original code state
              startCpuSampling();
              const beforeStartTime = Date.now();
              await new Promise((resolve) => setTimeout(resolve, 600));
              const beforeResult = await analyzeSustainability(beforeStartTime);

              // AFTER: fresh sample window on the optimized code state
              startCpuSampling();
              const afterStartTime = Date.now();
              await new Promise((resolve) => setTimeout(resolve, 600));
              const afterResult = await analyzeSustainability(afterStartTime);

              sustainabilityResult = {
                energyKwh: afterResult.energyKwh,
                carbonGrams: afterResult.carbonGrams,
                beforeEnergyKwh: beforeResult.energyKwh,
                beforeCarbonGrams: beforeResult.carbonGrams,
              };

              sustainaDevOutput.appendLine(
                "=== Sustainability Metrics — Before ===",
              );
              sustainaDevOutput.appendLine(
                `Energy:  ${beforeResult.energyKwh.toFixed(6)} kWh`,
              );
              sustainaDevOutput.appendLine(
                `Carbon:  ${beforeResult.carbonGrams.toFixed(4)} gCO₂`,
              );

              sustainaDevOutput.appendLine(
                "=== Sustainability Metrics — After ===",
              );
              sustainaDevOutput.appendLine(
                `Energy:  ${afterResult.energyKwh.toFixed(6)} kWh`,
              );
              sustainaDevOutput.appendLine(
                `Carbon:  ${afterResult.carbonGrams.toFixed(4)} gCO₂`,
              );

              sustainaDevOutput.appendLine("=== Result ===");
              sustainaDevOutput.appendLine(
                `Energy saved:  ${(
                  beforeResult.energyKwh - afterResult.energyKwh
                ).toFixed(6)} kWh`,
              );
              sustainaDevOutput.appendLine(
                `Carbon saved:  ${(
                  beforeResult.carbonGrams - afterResult.carbonGrams
                ).toFixed(4)} gCO₂`,
              );
            } catch (err) {
              sustainaDevOutput.appendLine("Sustainability analysis failed:");
              sustainaDevOutput.appendLine(String(err));
            }

            vscode.window.showInformationMessage(
              report.metric === "space"
                ? `Space improved: ${report.before} → ${report.after}`
                : `Complexity improved: ${report.before} → ${report.after}`,
            );

            const workspace =
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
              process.cwd();

            await logOptimizationFromReport(
              workspace,
              filePath,
              report,
              patch.reason,
              sustainabilityResult,
              decision.type,
            );
          } else if (choice) {
            vscode.window.showInformationMessage("❌ Optimization discarded.");
          }
        });
    } else {
      vscode.window.showInformationMessage("No actionable refactor suggested.");
    }
  } catch (err: any) {
    if (err.message === "ALREADY_OPTIMIZED") {
      isRunning = false;
      return;
    }
    if (err instanceof UnsupportedLanguageError) {
      vscode.window.showInformationMessage(err.message);
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
          path.join(context.extensionPath, "src", "presentation", "media"),
        ),
      ],
    },
  );

  const dashboardPath = path.join(
    context.extensionPath,
    "src",
    "presentation",
    "media",
    "dashboard.html",
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

  // Single onDidReceiveMessage handler — duplicate removed
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
    context.subscriptions,
  );
}


/* =========================================================================
   HELPER FUNCTIONS
   ========================================================================= */

async function closeExistingPreview(previewPath: string) {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      // Look specifically for Diff editors where the 'modified' side is our temp preview file
      if (tab.input instanceof vscode.TabInputTextDiff) {
        if (tab.input.modified.fsPath === previewPath) {
          await vscode.window.tabGroups.close(tab);
          return;
        }
      }
      // Also check standard text editors (in case the user opened it directly)
      if (tab.input instanceof vscode.TabInputText) {
        if (tab.input.uri.fsPath === previewPath) {
          await vscode.window.tabGroups.close(tab);
          return;
        }
      }
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
) {
  const document = await vscode.workspace.openTextDocument(uri);
  const we = new vscode.WorkspaceEdit();
  
  // Calculate the full range based on the CURRENT state of the file
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(document.lineCount - 1).range.end
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
          ? (
              (battery.maxCapacity / battery.designedCapacity) *
              100
            ).toFixed(0)
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
    const cpu = await Promise.race([
      si.cpu(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("CPU timeout")), 5000),
      ),
    ]);
    cpuInfo = `${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)`;
  } catch (e: any) {
    cpuInfo = "Error loading CPU info";
    console.error("  ✗ CPU error:", e?.message);
  }

  try {
    const gpu = await Promise.race([
      si.graphics(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("GPU timeout")), 5000),
      ),
    ]);
    gpuModel =
      gpu.controllers && gpu.controllers.length > 0
        ? gpu.controllers[0].model
        : "No GPU detected";
  } catch (e: any) {
    gpuModel = "Error loading GPU info";
    console.error("  ✗ GPU error:", e?.message);
  }

  try {
    const mem = await Promise.race([
      si.mem(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("RAM timeout")), 5000),
      ),
    ]);
    ramGB = `${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB`;
  } catch (e: any) {
    ramGB = "Error loading RAM info";
    console.error("  ✗ RAM error:", e?.message);
  }

  try {
    const osInfo = await Promise.race([
      si.osInfo(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("OS timeout")), 5000),
      ),
    ]);
    osString = `${osInfo.distro} (${osInfo.arch})`;
  } catch (e: any) {
    osString = "Error loading OS info";
    console.error("  ✗ OS error:", e?.message);
  }

  try {
    const disks = await Promise.race([
      si.diskLayout(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("Disk timeout")), 5000),
      ),
    ]);
    diskInfo =
      disks
        .map((d: any, index: number) => {
          const sizeGB = d.size
            ? (d.size / 1024 / 1024 / 1024).toFixed(1)
            : "0";
          const type = d.type || "Unknown";
          const name = d.name || d.vendor || `Disk ${index + 1}`;
          return `• ${type} • ${name} • ${sizeGB} GB`;
        })
        .join("\n") || "No disks detected";
  } catch (e: any) {
    diskInfo = "Error loading disk info";
    console.error("  ✗ Disk error:", e?.message);
  }

  try {
    const battery = await Promise.race([
      si.battery(),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("Battery timeout")), 5000),
      ),
    ]);
    batteryInfo = battery.hasBattery
      ? `Health: ${
          battery.designedCapacity && battery.maxCapacity
            ? (
                (battery.maxCapacity / battery.designedCapacity) *
                100
              ).toFixed(0)
            : "N/A"
        }% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
      : "No battery detected";
  } catch (e: any) {
    batteryInfo = "Error loading battery info";
    console.error("  ✗ Battery error:", e?.message);
  }

  return {
    cpu: cpuInfo,
    gpu: gpuModel,
    ram: ramGB,
    os: osString,
    disks: diskInfo,
    battery: batteryInfo,
  };
}