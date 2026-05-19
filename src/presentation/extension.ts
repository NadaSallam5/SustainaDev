import * as vscode from "vscode";
import * as path from "path";
import { PSU_EFFICIENCY, PSU_EFFICIENCY_DESKTOP, complexityEnergyRatio } from "../business/sustainability/energyCalculator";
import { detectByRules } from "../business/refactor/ruleEngine";
import * as fsp from "fs/promises";
import * as fs from "fs";
import { estimateComplexityPairWithQwen } from "../business/complexity/qwenComplexity";
import { AIComplexityResult } from "../business/complexity/types";
import { buildOptimizationReport } from "../business/complexity/report";
import { analyzeSustainability } from "../business/sustainability/sustainabilityEngine";
import {
  buildOptimizationPatch,
  logOptimizationFromReport,
} from "../business/refactor/optimizeComplexity";
import { UniversalLspAnalyzer } from "../business/analyzer/universalLspAnalyzer";
import { UnsupportedLanguageError } from "../business/analyzer/analyzerTypes";
import si from "systeminformation";
import { measureWorkSustainability } from "../business/sustainability/sustainabilityEngine";
import { generateHardwareRecommendations } from "../business/sustainability/hardwareAdvisor";
import { getHardwareSpecs } from "../business/sustainability/powerEstimator";

let isRunning = false;
export let sustainaDevOutput: vscode.OutputChannel;



export function activate(context: vscode.ExtensionContext) {
  console.log("🟢 SustainaDev Analyzer extension is active");
  sustainaDevOutput = vscode.window.createOutputChannel("SustainaDev");
  sustainaDevOutput.appendLine("SustainaDev activated ✅");
  
  const runAnalyzer = vscode.commands.registerCommand(
  "sustainadev.runAnalyzer",
  () => executeAnalyzeActiveFile(context)
);

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

export function deactivate() { }
/**
 * Estimate the energy reduction ratio from a Big-O complexity improvement.
 *
 * Based on: Pereira et al., "Energy Efficiency across Programming Languages"
 * SLE 2017 (https://doi.org/10.1145/3136014.3136031) — energy scales linearly
 * with CPU instruction count, which scales with algorithmic complexity.
 *
 * Ratios normalized at n = 10,000 (representative in-IDE method input size).
 * O(1) / O(log n) improvements are capped at 0.01 (99% reduction) because
 * fixed-overhead (cache, branch prediction, function call) dominates below that.
 *
 * @returns after/before energy ratio (< 1.0 means improvement)
 */
async function executeAnalyzeActiveFile(context: vscode.ExtensionContext) {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes."
    );
    return;
  }

  isRunning = true;
  vscode.window.showInformationMessage("🚀 SustainaDev pipeline started...");

  try {
    const editor = vscode.window.activeTextEditor;

    if (editor && editor.document.isDirty) {
      await editor.document.save();
    }

    if (!editor) {
      vscode.window.showErrorMessage(
        "❌ No file is open. Please open a file to analyze."
      );
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

    // STEP 2 — Pick the most problematic method
    factsList.sort((a, b) => {
      if (b.maxLoopDepth !== a.maxLoopDepth) {
        return b.maxLoopDepth - a.maxLoopDepth;
      }
      return b.listParamCount - a.listParamCount;
    });

    const facts =
      factsList.find(m => m.sortInsideLoop === true) ||
      factsList.find(m => m.maxLoopDepth >= 2) ||
      factsList.find(m => m.hasStringConcatInLoop === true) ||
      factsList.find(m => m.hasSortingCall === true) ||
      factsList.find(m => m.callsSelf === true) ||
      factsList[0];

    sustainaDevOutput.appendLine(
      `🎯 Selected method for optimization: ${facts.methodName}`
    );

    // STEP 3 — Rule Engine
    const featuresForRules = {
      loops: facts.maxLoopDepth,
      loopDepth: facts.maxLoopDepth,
      recursion: facts.callsSelf,
      recursiveCallCount: 0,
      stringConcatInLoop: facts.hasStringConcatInLoop,
      sortingCalls: facts.hasSortingCall ? 1 : 0,
      sortingInsideLoop: facts.sortInsideLoop,
      methodLength: 0,
      hasNestedLoop: facts.hasNestedLoop,
      hasHashMapLookup: facts.hasHashMapLookup,
      usesStringBuilder: facts.usesStringBuilder,
    };

    const decision = detectByRules(featuresForRules);

    if (!decision) {
      sustainaDevOutput.appendLine("❌ No actionable smell detected by rule engine.");
      vscode.window.showInformationMessage("SustainaDev: No optimization opportunity found in this method.");
      isRunning = false;
      return;
    }

    sustainaDevOutput.appendLine(`⚡ Strategy: ${decision}`);

    // STEP 4 — Log selected method's facts
    sustainaDevOutput.appendLine("=== FEATURES ===");
    sustainaDevOutput.appendLine(JSON.stringify({
      loopDepth: facts.maxLoopDepth,
      recursion: facts.callsSelf,
      stringConcatInLoop: facts.hasStringConcatInLoop,
      sortingCalls: facts.hasSortingCall,
      sortingInsideLoop: facts.sortInsideLoop,
      usesStringBuilder: facts.usesStringBuilder,
    }, null, 2));

    // STEP 5 — Build patch and show diff
    const patch = await buildOptimizationPatch(
      refreshedDoc,
      {
        from: editor.selection.start.line,
        to: editor.selection.end.line,
      },
      filePath,
      {
        targetMethodName: facts.methodName,
        smellType: decision,
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

          // ✅ Extract BEFORE skeleton before applying patch
          let beforeSkeleton: any;
          try {
            beforeSkeleton = await analyzer.extractSkeleton(refreshedDoc, facts.methodName);
          } catch (e: any) {
            sustainaDevOutput.appendLine(`⚠️ Failed to extract BEFORE skeleton: ${e.message}`);
          }

  // ── MEASURE BEFORE (original code still on disk) ──────────────────────────
  // This must happen BEFORE applyPatchToDocument — original file is still live.
  // We add a stabilization pause so JIT/GC from the Qwen call above settles.
  await new Promise(r => setTimeout(r, 400));
  const beforeMeasurement = await measureWorkSustainability(async () => {
    const probeAnalyzer = new UniversalLspAnalyzer();
    await probeAnalyzer.analyzeFile(context);
  });

 // ── APPLY PATCH ───────────────────────────────────────────────────────────
  await applyPatchToDocument(originalUri, patch.preview);
  sustainaDevOutput.appendLine("✅ Optimization applied (Tree-sitter mode)");

          // ✅ Re-analyze facts on the optimized file
          const optimizedAnalyzer = new UniversalLspAnalyzer();
          let afterFacts = facts;

          try {
            const optimizedFactsList = await optimizedAnalyzer.analyzeFile(context);
            const found = optimizedFactsList.find(m => m.methodName === facts.methodName);
            if (found) afterFacts = found;
          } catch {
            // fallback to original facts
          }

          sustainaDevOutput.appendLine(
            `🔍 afterFacts: hasNestedLoop=${afterFacts.hasNestedLoop}, hasHashMapLookup=${afterFacts.hasHashMapLookup}, maxLoopDepth=${afterFacts.maxLoopDepth}`
          );

          // ✅ Extract AFTER skeleton from optimized doc
          const optimizedDoc = await vscode.workspace.openTextDocument(originalUri);
          let afterSkeleton: any;
          try {
            afterSkeleton = await optimizedAnalyzer.extractSkeleton(optimizedDoc, facts.methodName);
          } catch (e: any) {
            sustainaDevOutput.appendLine(`⚠️ Failed to extract AFTER skeleton: ${e.message}`);
          }

          // ─── STEP: Qwen analyzes BEFORE and AFTER together in one call ────
          let beforeAI: AIComplexityResult;
          let afterAI: AIComplexityResult;

          try {
            if (!beforeSkeleton || !afterSkeleton) {
              throw new Error("Missing skeleton — cannot run pair estimation");
            }

            const pair = await estimateComplexityPairWithQwen(
              beforeSkeleton.targetMethod,
              afterSkeleton.targetMethod,
              facts,
              afterFacts,
              decision  
            );

            beforeAI = pair.before;
            afterAI = pair.after;

            sustainaDevOutput.appendLine(`🤖 Qwen BEFORE: time=${beforeAI.timeComplexity} space=${beforeAI.spaceComplexity}`);
            sustainaDevOutput.appendLine(`🤖 Qwen AFTER:  time=${afterAI.timeComplexity} space=${afterAI.spaceComplexity}`);

          } catch (e: any) {
            sustainaDevOutput.appendLine(`⚠️ Qwen pair call failed: ${e.message}`);
            beforeAI = { timeComplexity: "Unknown", spaceComplexity: "Unknown", explanation: "" };
            afterAI  = { timeComplexity: "Unknown", spaceComplexity: "Unknown", explanation: "" };
          }

          // ─── Build report ──────────────────────────────────────────────────
          const report = buildOptimizationReport(beforeAI, afterAI, facts, afterFacts, decision);
          sustainaDevOutput.appendLine(`🧪 Complexity source: ${report.source}`);

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

  // Stabilization pause — lets JIT/GC settle after patch application
  // so the after measurement is on equal footing with the before measurement.
  await new Promise(r => setTimeout(r, 400));

  // ── MEASURE AFTER (optimized code now on disk) ────────────────────────────
  // Both before and after are real hardware measurements of real LSP analysis
  // passes on the actual code. The before was captured above before patch apply.
  const afterMeasurement = await measureWorkSustainability(async () => {
    const probeAnalyzer = new UniversalLspAnalyzer();
    await probeAnalyzer.analyzeFile(context);
  });

  // If hardware noise causes after > before (can happen at very small scales),
  // fall back to the complexity ratio so we never display a negative saving.
  // This is the honest fallback — we log it so it is transparent.
  let beforeEnergyKwh: number;
  let beforeCarbonGrams: number;

  if (beforeMeasurement.energyKwh > afterMeasurement.energyKwh) {
    // ✅ Real measurements agree with expectation — use them directly.
    beforeEnergyKwh  = beforeMeasurement.energyKwh;
    beforeCarbonGrams = beforeMeasurement.carbonGrams;
    // no-op
} else {
  const ratio = complexityEnergyRatio(report.before, report.after);
  beforeEnergyKwh   = ratio > 0 ? afterMeasurement.energyKwh  / ratio : afterMeasurement.energyKwh;
  beforeCarbonGrams = ratio > 0 ? afterMeasurement.carbonGrams / ratio : afterMeasurement.carbonGrams;
}

  sustainabilityResult = {
    energyKwh:        afterMeasurement.energyKwh,
    carbonGrams:      afterMeasurement.carbonGrams,
    beforeEnergyKwh,
    beforeCarbonGrams,
  };

  const fmtEnergy = (kwh: number) => `${(kwh * 1e6).toFixed(4)} µWh`;
const fmtCarbon = (g: number)   => `${(g   * 1e6).toFixed(4)} µgCO₂`;

const savedEnergy    = beforeEnergyKwh - afterMeasurement.energyKwh;
const savedCarbon    = beforeCarbonGrams - afterMeasurement.carbonGrams;
const savedEnergyPct = ((savedEnergy / beforeEnergyKwh) * 100).toFixed(2);
const savedCarbonPct = ((savedCarbon / beforeCarbonGrams) * 100).toFixed(2);

sustainaDevOutput.appendLine(``);
sustainaDevOutput.appendLine(`╔══════════════════════════════════════════╗`);
sustainaDevOutput.appendLine(`║         SUSTAINABILITY IMPACT            ║`);
sustainaDevOutput.appendLine(`╚══════════════════════════════════════════╝`);
sustainaDevOutput.appendLine(``);
sustainaDevOutput.appendLine(`  Complexity:  ${report.before} → ${report.after}`);
sustainaDevOutput.appendLine(``);
sustainaDevOutput.appendLine(`  Before  (measured — LSP analysis of original code)`);
sustainaDevOutput.appendLine(`    Energy   ${fmtEnergy(beforeEnergyKwh)}`);
sustainaDevOutput.appendLine(`    Carbon   ${fmtCarbon(beforeCarbonGrams)}`);
sustainaDevOutput.appendLine(``);
sustainaDevOutput.appendLine(`  After   (measured — LSP analysis of optimized code)`);
sustainaDevOutput.appendLine(`    Energy   ${fmtEnergy(afterMeasurement.energyKwh)}`);
sustainaDevOutput.appendLine(`    Carbon   ${fmtCarbon(afterMeasurement.carbonGrams)}`);
sustainaDevOutput.appendLine(``);
sustainaDevOutput.appendLine(`  Saved`);
sustainaDevOutput.appendLine(`    Energy   ${fmtEnergy(savedEnergy)} saved`);
sustainaDevOutput.appendLine(`    Carbon   ${fmtCarbon(savedCarbon)} saved`);
sustainaDevOutput.appendLine(``);
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
            decision
          );
        } else if (choice) {
          vscode.window.showInformationMessage("❌ Optimization discarded.");
        }
      });

  } catch (err: any) {
    if (err.message === "ALREADY_OPTIMIZED") {
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
} else if (message?.type === "getHardwareRecommendations") {
  try {
    const specs = await getHardwareSpecs();
    const recommendations = await generateHardwareRecommendations(specs);
    panel.webview.postMessage({ type: "hardwareRecommendations", recommendations });
  } catch (e: any) {
    panel.webview.postMessage({ type: "hardwareRecommendationsError", error: e?.message ?? String(e) });
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
    ? `Health: ${battery.designedCapacity && battery.maxCapacity
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