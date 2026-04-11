import * as vscode from "vscode";
import * as path from "path";

import { detectByRules } from "../business/refactor/ruleEngine";

import * as fsp from "fs/promises";
import * as fs from "fs";

import { buildOptimizationReport } from "../business/complexity/report";
import { analyzeSustainability } from "../business/sustainability/sustainabilityEngine";
import {
  buildOptimizationPatch,
  logOptimizationFromReport,
} from "../business/refactor/optimizeComplexity";
import { chooseRefactor } from "../business/refactor/chooseRefactor";
import { initPaths, startCpuSampling } from "../business/codeCarbon";
import { UniversalLspAnalyzer } from "../business/analyzer/universalLspAnalyzer";
import { UnsupportedLanguageError } from "../business/analyzer/analyzerTypes";
import si from "systeminformation";

// CHANGED: Removed parseCode and extractFeatures imports — no longer doing
// full-file Tree-sitter scans in extension.ts. Feature extraction is now
// done per-method inside universalLspAnalyzer.analyzeFile().

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

export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");
  sustainaDevOutput = vscode.window.createOutputChannel("SustainaDev");
  sustainaDevOutput.appendLine("SustainaDev activated ✅");

  const analyzeActiveFile = vscode.commands.registerCommand(
    "sustainadev.analyzeActiveFile",
    () => executeAnalyzeActiveFile(context)
  );

  const openDash = vscode.commands.registerCommand(
    "sustainadev.openDashboard",
    () => executeOpenDashboard(context)
  );

  const getSpecs = vscode.commands.registerCommand(
    "sustainadev.getSpecs",
    async () => {
      vscode.window.showInformationMessage("🔍 Collecting system specs...");
      try {
        const msg = await collectHardwareSpecsMarkdown();
        vscode.window.showInformationMessage(msg, { modal: true });
      } catch (err: any) {
        vscode.window.showErrorMessage(
          "❌ Failed to read system specs: " + err.message
        );
      }
    }
  );

  context.subscriptions.push(analyzeActiveFile, openDash, getSpecs);
}

export function deactivate() {}

async function executeAnalyzeActiveFile(context: vscode.ExtensionContext) {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes."
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

    // Language gate
    const languageId = editor.document.languageId;
    const supported = new Set(["java", "python", "javascript", "typescript"]);
    if (!supported.has(languageId)) {
      vscode.window.showInformationMessage(
        `SustainaDev: "${languageId}" is not yet supported. ` +
          `Java, Python, JavaScript and TypeScript are supported.`
      );
      isRunning = false;
      return;
    }

    const analyzer = new UniversalLspAnalyzer();

    const originalUri = editor.document.uri;
    const filePath = originalUri.fsPath;
    const refreshedDoc = await vscode.workspace.openTextDocument(originalUri);
    await refreshedDoc.save();

    // STEP 1 — Scan ALL methods in the file via LSP + Tree-sitter (per-method)
    // analyzeFile uses LSP to find methods, Tree-sitter per method for smell detection.
    const factsList = await analyzer.analyzeFile(context);

    if (!factsList || factsList.length === 0) {
      vscode.window.showInformationMessage(
        "SustainaDev: No methods detected in this file. Make sure the language server is active."
      );
      isRunning = false;
      return;
    }

    sustainaDevOutput.appendLine(
      `📋 Methods found: ${factsList.map(m => m.methodName).join(', ')}`
    );

    // STEP 2 — Pick the most problematic method by priority
    // Priority: sorting-in-loop > nested loops > string concat > sorting > first method
    const facts =
      factsList.find(m => m.sortInsideLoop === true) ||
      factsList.find(m => m.maxLoopDepth >= 2) ||
      factsList.find(m => m.hasStringConcatInLoop === true) ||
      factsList.find(m => m.hasSortingCall === true) ||
      factsList[0];

    sustainaDevOutput.appendLine(
      `🎯 Selected method for optimization: ${facts.methodName}`
    );

    // STEP 3 — Rule Engine with AI fallback
    const featuresForRules = {
  loops: facts.maxLoopDepth,
  loopDepth: facts.maxLoopDepth,
  recursion: facts.callsSelf,
  recursiveCallCount: 0,           // ✅ add this
  stringConcatInLoop: facts.hasStringConcatInLoop,
  sortingCalls: facts.hasSortingCall ? 1 : 0,
  sortingInsideLoop: facts.sortInsideLoop,
  methodLength: 0,
};

    const ruleDecision = detectByRules(featuresForRules);
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
      vscode.window.showInformationMessage("No optimization decision made.");
      isRunning = false;
      return;
    }

    sustainaDevOutput.appendLine(`🔧 Strategy: ${decision.type}`);

    // STEP 4 — Log selected method's facts (already computed per-method in analyzeFile)
    // CHANGED: Removed full-file parseCode + extractFeatures scan. Use facts directly.
    sustainaDevOutput.appendLine("=== FEATURES ===");
    sustainaDevOutput.appendLine(JSON.stringify({
      loopDepth: facts.maxLoopDepth,
      recursion: facts.callsSelf,
      stringConcatInLoop: facts.hasStringConcatInLoop,
      sortingCalls: facts.hasSortingCall,
      sortingInsideLoop: facts.sortInsideLoop,
    }, null, 2));

    // STEP 5 — Build patch and show diff
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
        analyzer
      );

      void vscode.window
        .showQuickPick(["✅ Accept Optimization", "❌ Reject"], {
          placeHolder: "Apply the optimized code?",
          ignoreFocusOut: true,
        })
        .then(async (choice) => {
          // Proactive cleanup of temp preview file
          if (patch.previewUri) {
            try {
              await closeExistingPreview(patch.previewUri);
              if (fs.existsSync(patch.previewUri)) {
                await fsp.unlink(patch.previewUri);
              }
              console.log(`🧹 Proactive cleanup: ${patch.previewUri}`);
            } catch (e) {
              console.warn(
                `⚠️ Failed to cleanup preview file: ${patch.previewUri}`,
                e
              );
            }
          }

          if (choice === "✅ Accept Optimization") {
            await applyPatchToDocument(originalUri, patch.preview);

            sustainaDevOutput.appendLine(
              "✅ Optimization applied (Tree-sitter mode)"
            );

            // CHANGED: Build afterFacts from patch preview using analyzeFile
            // on the optimized content instead of a full-file Tree-sitter scan.
            // We reuse facts structure but scan the optimized file for after-metrics.
            const optimizedDoc = await vscode.workspace.openTextDocument(originalUri);
            const optimizedAnalyzer = new UniversalLspAnalyzer();
            let afterFacts = facts; // fallback to before-facts if re-analysis fails

            try {
              const optimizedFactsList = await optimizedAnalyzer.analyzeFile(context);
              const found = optimizedFactsList.find(m => m.methodName === facts.methodName);
              if (found) afterFacts = found;
            } catch {
              // If re-analysis fails after apply, keep before facts — report will show no change
            }

            const report = buildOptimizationReport(facts, afterFacts);

            sustainaDevOutput.appendLine(
              report.metric === "space"
                ? "=== Space Complexity Report ==="
                : "=== Complexity Report ==="
            );

            if (report.metric === "space") {
              sustainaDevOutput.appendLine(`Space Before: ${report.before}`);
              sustainaDevOutput.appendLine(`Space After:  ${report.after}`);
            } else {
              sustainaDevOutput.appendLine(`Before: ${report.before}`);
              sustainaDevOutput.appendLine(`After:  ${report.after}`);
            }

            sustainaDevOutput.appendLine(`Improvement: ${report.improvement}`);

            let sustainabilityResult:
              | {
                  energyKwh: number;
                  carbonGrams: number;
                  beforeEnergyKwh: number;
                  beforeCarbonGrams: number;
                }
              | undefined;

            try {
              sustainaDevOutput.appendLine("Running sustainability analysis...");

              startCpuSampling();
              const beforeStartTime = Date.now();
              await new Promise((resolve) => setTimeout(resolve, 600));
              const beforeResult = await analyzeSustainability(beforeStartTime);

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

              sustainaDevOutput.appendLine("=== Sustainability Metrics — Before ===");
              sustainaDevOutput.appendLine(`Energy:  ${beforeResult.energyKwh.toFixed(6)} kWh`);
              sustainaDevOutput.appendLine(`Carbon:  ${beforeResult.carbonGrams.toFixed(4)} gCO₂`);
              sustainaDevOutput.appendLine("=== Sustainability Metrics — After ===");
              sustainaDevOutput.appendLine(`Energy:  ${afterResult.energyKwh.toFixed(6)} kWh`);
              sustainaDevOutput.appendLine(`Carbon:  ${afterResult.carbonGrams.toFixed(4)} gCO₂`);
              sustainaDevOutput.appendLine("=== Result ===");
              sustainaDevOutput.appendLine(
                `Energy saved:  ${(beforeResult.energyKwh - afterResult.energyKwh).toFixed(6)} kWh`
              );
              sustainaDevOutput.appendLine(
                `Carbon saved:  ${(beforeResult.carbonGrams - afterResult.carbonGrams).toFixed(4)} gCO₂`
              );
            } catch (err) {
              sustainaDevOutput.appendLine("Sustainability analysis failed:");
              sustainaDevOutput.appendLine(String(err));
            }

            vscode.window.showInformationMessage(
              report.metric === "space"
                ? `Space improved: ${report.before} → ${report.after}`
                : `Complexity improved: ${report.before} → ${report.after}`
            );

            const workspace =
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

            await logOptimizationFromReport(
              workspace,
              filePath,
              report,
              patch.reason,
              sustainabilityResult,
              decision.type
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
    vscode.window.showErrorMessage(`❌ SustainaDev failed: ${err.message || err}`);
  } finally {
    isRunning = false;
    vscode.window.showInformationMessage("🟢 SustainaDev pipeline ready for next run.");
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
          path.join(context.extensionPath, "src", "presentation", "media")
        ),
      ],
    }
  );

  const dashboardPath = path.join(
    context.extensionPath,
    "src", "presentation", "media", "dashboard.html"
  );

  try {
    const html = await fsp.readFile(dashboardPath, "utf8");
    panel.webview.html = html;
  } catch (e: any) {
    panel.webview.html = `<html><body><h3>Dashboard error</h3><pre>${e?.message ?? e}</pre></body></html>`;
  }

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
      } else if (message?.type === "getSpecs") {
        try {
          const content = await collectHardwareSpecsMarkdown();
          panel.webview.postMessage({ type: "specsContent", content });
        } catch (e: any) {
          panel.webview.postMessage({ type: "specsError", error: e?.message ?? String(e) });
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

async function closeExistingPreview(previewPath: string) {
  const win = vscode.window as any;
  if (!win.tabGroups) return;
  for (const group of win.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.input?.modified?.fsPath === previewPath ||
        tab.input?.uri?.fsPath === previewPath
      ) {
        await win.tabGroups.close(tab);
        return;
      }
    }
  }
}

async function applyPatchToDocument(uri: vscode.Uri, content: string) {
  const document = await vscode.workspace.openTextDocument(uri);
  const we = new vscode.WorkspaceEdit();
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
    const content = await fsp.readFile(path.join(ws, "analysis-report.json"), "utf8");
    panel.webview.postMessage({ type: "analysisContent", content });
  } catch (e: any) {
    panel.webview.postMessage({ type: "analysisError", error: e?.message ?? String(e) });
  }
}

async function handleReadLog(panel: vscode.WebviewPanel, ws: string) {
  try {
    const logPath = path.join(ws, ".sustainadev", "log.jsonl");
    const raw = await fsp.readFile(logPath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    panel.webview.postMessage({ type: "logContent", lines });
  } catch (e: any) {
    panel.webview.postMessage({ type: "logError", error: e?.message ?? String(e) });
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

  return `💻 System Specifications\n\n🧠 CPU: ${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)\n🎮 GPU: ${gpuModel}\n📦 RAM: ${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB\n🖥️ OS: ${os.distro} (${os.arch})\n\n💽 Disks:\n${diskInfo || "No disk info"}\n\n🔋 Battery:\n${batteryInfo}\n`;
}

async function handleReadHardware(panel: vscode.WebviewPanel) {
  try {
    const specs = await collectHardwareSpecsForDashboard();
    panel.webview.postMessage({ type: "hardwareContent", specs });
  } catch (e: any) {
    panel.webview.postMessage({ type: "hardwareError", error: e?.message ?? String(e) });
  }
}

async function collectHardwareSpecsForDashboard(): Promise<{
  cpu: string; gpu: string; ram: string; os: string; disks: string; battery: string;
}> {
  let cpuInfo = "Loading...";
  let gpuModel = "Loading...";
  let ramGB = "Loading...";
  let osString = "Loading...";
  let diskInfo = "Loading...";
  let batteryInfo = "Loading...";

  try {
    const cpu = await Promise.race([si.cpu(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    cpuInfo = `${cpu.manufacturer} ${cpu.brand} (${cpu.cores} cores)`;
  } catch (e: any) { cpuInfo = "Error loading CPU info"; }

  try {
    const gpu = await Promise.race([si.graphics(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    gpuModel = gpu.controllers?.length > 0 ? gpu.controllers[0].model : "No GPU detected";
  } catch (e: any) { gpuModel = "Error loading GPU info"; }

  try {
    const mem = await Promise.race([si.mem(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    ramGB = `${(mem.total / 1024 / 1024 / 1024).toFixed(2)} GB`;
  } catch (e: any) { ramGB = "Error loading RAM info"; }

  try {
    const osInfo = await Promise.race([si.osInfo(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    osString = `${osInfo.distro} (${osInfo.arch})`;
  } catch (e: any) { osString = "Error loading OS info"; }

  try {
    const disks = await Promise.race([si.diskLayout(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    diskInfo = disks.map((d: any, i: number) => {
      const sizeGB = d.size ? (d.size / 1024 / 1024 / 1024).toFixed(1) : "0";
      return `• ${d.type || "Unknown"} • ${d.name || d.vendor || `Disk ${i + 1}`} • ${sizeGB} GB`;
    }).join("\n") || "No disks detected";
  } catch (e: any) { diskInfo = "Error loading disk info"; }

  try {
    const battery = await Promise.race([si.battery(), new Promise<any>((_, r) => setTimeout(() => r(new Error("timeout")), 5000))]);
    batteryInfo = battery.hasBattery
      ? `Health: ${battery.designedCapacity && battery.maxCapacity ? ((battery.maxCapacity / battery.designedCapacity) * 100).toFixed(0) : "N/A"}% • Charging: ${battery.isCharging} • Capacity: ${battery.percent}%`
      : "No battery detected";
  } catch (e: any) { batteryInfo = "Error loading battery info"; }

  return { cpu: cpuInfo, gpu: gpuModel, ram: ramGB, os: osString, disks: diskInfo, battery: batteryInfo };
}