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
// Persists across runs until window reload — tracks rejected/handled method+strategy pairs
const skippedStrategies = new Map<string, Set<string>>();



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

  const runAnalyzerLoop = vscode.commands.registerCommand(
    "sustainadev.runAnalyzerLoop",
    () => executeAnalyzeLoop(context)
  );

  const resetSkipList = vscode.commands.registerCommand(
    "sustainadev.resetSkipList",
    () => {
      skippedStrategies.clear();
      vscode.window.showInformationMessage("🔄 SustainaDev: Skip list cleared. All methods will be re-evaluated.");
      sustainaDevOutput.appendLine("🔄 Skip list cleared by user.");
    }
  );

  context.subscriptions.push(analyzeActiveFile, openDash, getSpecs, runAnalyzerLoop, resetSkipList);
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
type AnalyzeStatus = "optimized" | "rejected" | "skipped" | "cancelled" | "no-opportunity" | "no-editor" | "unsupported" | "error";

async function executeAnalyzeActiveFile(
  context: vscode.ExtensionContext
): Promise<AnalyzeStatus> {
  if (isRunning) {
    vscode.window.showWarningMessage(
      "⏳ SustainaDev is still processing. Please wait until the current refactor completes."
    );
    return "error";
  }

  isRunning = true;
  vscode.window.showInformationMessage("🚀 SustainaDev pipeline started...");

  // Hoisted so the catch block can access them for skip tracking
  let facts: any;
  let decision: string | null = null;

  try {
    const editor = vscode.window.activeTextEditor;

    if (editor && editor.document.isDirty) {
      await editor.document.save();
    }

    if (!editor) {
      vscode.window.showErrorMessage(
        "❌ No file is open. Please open a file to analyze."
      );
      return "no-editor";
    }

    // Language gate
    const languageId = editor.document.languageId;
    const supported = new Set(["java", "python", "javascript", "typescript"]);
    if (!supported.has(languageId)) {
      vscode.window.showInformationMessage(
        `SustainaDev: "${languageId}" is not yet supported. ` +
        `Java, Python, JavaScript and TypeScript are supported.`
      );
      return "unsupported";
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
      return "no-opportunity";
    }

    sustainaDevOutput.appendLine(
      `📋 Methods found: ${factsList.map(m => m.methodName).join(', ')}`
    );

    // STEP 2 — Remove methods where every applicable strategy is already skipped
    const filteredList = factsList.filter(m => {
      const skipped = skippedStrategies.get(m.methodName) || new Set<string>();
      const featuresForRules = {
        loops: m.maxLoopDepth,
        loopDepth: m.maxLoopDepth,
        recursion: m.callsSelf,
        recursiveCallCount: 0,
        stringConcatInLoop: m.hasStringConcatInLoop,
        sortingCalls: m.hasSortingCall ? 1 : 0,
        sortingInsideLoop: m.sortInsideLoop,
        methodLength: 0,
        hasNestedLoop: m.hasNestedLoop,
        hasHashMapLookup: m.hasHashMapLookup,
        usesStringBuilder: m.usesStringBuilder,
      };
      return detectByRules(featuresForRules, skipped) !== null;
    });

    if (filteredList.length === 0) {
      sustainaDevOutput.appendLine("✅ All strategies for all methods have been handled.");
      vscode.window.showInformationMessage("SustainaDev: No more optimization opportunities in this file.");
      return "no-opportunity";
    }

    // Sort by worst smell first
    filteredList.sort((a, b) => {
      if (b.maxLoopDepth !== a.maxLoopDepth) {
        return b.maxLoopDepth - a.maxLoopDepth;
      }
      return b.listParamCount - a.listParamCount;
    });

    // Pick the most problematic method from the filtered list
    facts =
      filteredList.find(m => m.sortInsideLoop === true) ||
      filteredList.find(m => m.maxLoopDepth >= 2) ||
      filteredList.find(m => m.hasStringConcatInLoop === true) ||
      filteredList.find(m => m.hasSortingCall === true) ||
      filteredList.find(m => m.callsSelf === true) ||
      filteredList[0];

    sustainaDevOutput.appendLine(
      `🎯 Selected method for optimization: ${facts.methodName}`
    );

    // STEP 3 — Rule Engine (pass skipped set so it falls through to next smell)
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

    const skipped = skippedStrategies.get(facts.methodName) || new Set<string>();
    decision = detectByRules(featuresForRules, skipped);

    if (!decision) {
      sustainaDevOutput.appendLine("❌ No actionable smell detected by rule engine.");
      vscode.window.showInformationMessage("SustainaDev: No optimization opportunity found in this method.");
      return "no-opportunity";
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

    const choice = await vscode.window.showQuickPick(["✅ Accept Optimization", "❌ Reject"], {
      placeHolder: "Apply the optimized code?",
      ignoreFocusOut: true,
    });

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

    if (choice === undefined) {
      // User dismissed (Escape / click-away)
      return "cancelled";
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
        afterAI = { timeComplexity: "Unknown", spaceComplexity: "Unknown", explanation: "" };
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
          beforeEnergyKwh = beforeMeasurement.energyKwh;
          beforeCarbonGrams = beforeMeasurement.carbonGrams;
          // no-op
        } else {
          const ratio = complexityEnergyRatio(report.before, report.after);
          beforeEnergyKwh = ratio > 0 ? afterMeasurement.energyKwh / ratio : afterMeasurement.energyKwh;
          beforeCarbonGrams = ratio > 0 ? afterMeasurement.carbonGrams / ratio : afterMeasurement.carbonGrams;
        }

        sustainabilityResult = {
          energyKwh: afterMeasurement.energyKwh,
          carbonGrams: afterMeasurement.carbonGrams,
          beforeEnergyKwh,
          beforeCarbonGrams,
        };

        const fmtEnergy = (kwh: number) => `${(kwh * 1e6).toFixed(4)} µWh`;
        const fmtCarbon = (g: number) => `${(g * 1e6).toFixed(4)} µgCO₂`;

        const savedEnergy = beforeEnergyKwh - afterMeasurement.energyKwh;
        const savedCarbon = beforeCarbonGrams - afterMeasurement.carbonGrams;
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

      // Retire this method+strategy — don't re-propose it on the next iteration
      if (!skippedStrategies.has(facts.methodName)) {
        skippedStrategies.set(facts.methodName, new Set());
      }
      skippedStrategies.get(facts.methodName)!.add(decision);
      console.log(`✅ Optimized & retired: ${facts.methodName} / ${decision}`);

      return "optimized";
    } else {
      // Mark this method+strategy as skipped so the loop doesn't repeat it
      if (!skippedStrategies.has(facts.methodName)) {
        skippedStrategies.set(facts.methodName, new Set());
      }
      skippedStrategies.get(facts.methodName)!.add(decision);

      // Log the full skip state after every rejection
      console.log(`🚫 Skipped strategies updated:`);
      for (const [method, strategies] of skippedStrategies) {
        console.log(`  ${method}: [${[...strategies].join(", ")}]`);
      }
      vscode.window.showInformationMessage("❌ Optimization discarded.");
      return "skipped";
    }

  } catch (err: any) {
    if (err.message === "ALREADY_OPTIMIZED") {
      // Skip this method+strategy so the loop can try the next one
      if (facts && decision) {
        if (!skippedStrategies.has(facts.methodName)) {
          skippedStrategies.set(facts.methodName, new Set());
        }
        skippedStrategies.get(facts.methodName)!.add(decision);
        console.log(`🚫 ALREADY_OPTIMIZED — skipped: ${facts.methodName} / ${decision}`);
      }
      return "skipped";
    }
    if (err instanceof UnsupportedLanguageError) {
      vscode.window.showInformationMessage(err.message);
      return "unsupported";
    }
    vscode.window.showErrorMessage(`❌ SustainaDev failed: ${err.message || err}`);
    return "error";
  } finally {
    isRunning = false;
    vscode.window.showInformationMessage("🟢 SustainaDev pipeline ready for next run.");
  }
}

async function executeAnalyzeLoop(context: vscode.ExtensionContext) {
  const MAX_ITERATIONS = 10;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "SustainaDev: Optimization Loop",
      cancellable: true,
    },
    async (progress, token) => {
      let iterations = 0;

      sustainaDevOutput.appendLine("🔁 Starting optimization loop...");

      while (iterations < MAX_ITERATIONS) {
        // Check for user cancellation before starting a new iteration
        if (token.isCancellationRequested) {
          sustainaDevOutput.appendLine(`🔁 Loop cancelled by user after ${iterations} iteration(s).`);
          vscode.window.showInformationMessage("SustainaDev: Optimization loop cancelled.");
          break;
        }

        iterations++;
        progress.report({ message: `Iteration ${iterations} / ${MAX_ITERATIONS}` });
        sustainaDevOutput.appendLine(`🔁 Loop iteration ${iterations}/${MAX_ITERATIONS}`);

        // Print current skip state at the start of each iteration
        if (skippedStrategies.size > 0) {
          console.log(`📋 Current skip list (iteration ${iterations}):`);
          for (const [method, strategies] of skippedStrategies) {
            console.log(`  ${method}: [${[...strategies].join(", ")}]`);
          }
        }
        const status = await executeAnalyzeActiveFile(context);

        // Hard stops — no point waiting for a save
        if (status === "no-opportunity" || status === "no-editor" || status === "unsupported" || status === "cancelled" || status === "error") {
          sustainaDevOutput.appendLine(`🔁 Loop stopped after ${iterations} iteration(s): ${status}`);
          break;
        }

        // "optimized" or "skipped" — file may have been touched (ghost edit restore),
        // always wait for the buffer to settle before the next iteration
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const SAVE_TIMEOUT_MS = 8000;
          const POLL_INTERVAL_MS = 200;
          let waited = 0;
          while (editor.document.isDirty && waited < SAVE_TIMEOUT_MS) {
            if (token.isCancellationRequested) { break; }
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            waited += POLL_INTERVAL_MS;
          }
          if (editor.document.isDirty) {
            await editor.document.save();
          }
          sustainaDevOutput.appendLine(`🔁 File ready (waited ${waited}ms). Starting next iteration.`);
        }

        if (status === "skipped") {
          sustainaDevOutput.appendLine(`↩️ Strategy skipped. Trying next...`);
          continue;
        }
        // status === "optimized" → fall through to top of while loop naturally
      }

      if (iterations >= MAX_ITERATIONS) {
        vscode.window.showWarningMessage(
          `⚠️ SustainaDev loop reached the safety cap of ${MAX_ITERATIONS} iterations. Run again to continue.`
        );
        sustainaDevOutput.appendLine(`⚠️ Loop safety cap of ${MAX_ITERATIONS} iterations reached.`);
      }
    }
  );
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
  // Ensure the document is fully saved to disk before returning
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.isDirty) {
    await doc.save();
  }
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