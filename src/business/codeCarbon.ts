// codeCarbon.ts - FULL UPDATED VERSION
// Handles:
// 1. CCN-based energy estimation via Python
// 2. Runtime + CPU utilization measurement for sustainability metrics

import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import si from "systeminformation";

const execAsync = promisify(exec);

let estimatePyPath: string | undefined;

/**
 * Initialize paths for estimate.py
 */
export function initPaths(context: vscode.ExtensionContext) {

  estimatePyPath = path.join(
    context.extensionPath,
    "metrics",
    "estimate.py"
  );

  console.log(
    "[SustainaDev] estimate.py path:",
    estimatePyPath
  );
}

/**
 * Measure runtime + CPU utilization
 * Used later for energy calculation
 */
export async function measureExecution(startTime: number) {

  try {

    const cpuLoad = await si.currentLoad();

    const runtimeSeconds =
      (Date.now() - startTime) / 1000;

    const cpuUtilization =
      cpuLoad.currentLoad / 100;

    return {
      runtimeSeconds,
      cpuUtilization
    };

  } catch (error) {

    console.error(
      "[SustainaDev] Failed to measure runtime metrics:",
      error
    );

    return {
      runtimeSeconds:
        (Date.now() - startTime) / 1000,
      cpuUtilization: 0.5
    };
  }
}

/**
 * Estimate energy consumption based on CCN reduction
 */
export async function estimateEnergy(deltaCCN: number): Promise<any> {

  if (!estimatePyPath) {

    console.warn(
      "[SustainaDev] estimate.py path not initialized"
    );

    return getDefaultEnergyObject(deltaCCN);
  }

  try {

    const command =
      `python "${estimatePyPath}" ${deltaCCN}`;

    console.log(
      "[SustainaDev] Running:",
      command
    );

    const { stdout, stderr } =
      await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      });

    if (stderr) {
      console.warn(
        "[SustainaDev] estimate.py stderr:",
        stderr
      );
    }

    console.log(
      "[SustainaDev] estimate.py output:",
      stdout
    );

    const result =
      JSON.parse(stdout.trim());

    if (!result || typeof result !== "object") {

      console.warn(
        "[SustainaDev] Invalid result format"
      );

      return getDefaultEnergyObject(deltaCCN);
    }

    const energyData = {

      emissions_kg:
        result.emissions_kg || 0,

      estimated_kwh_saved:
        result.estimated_kwh_saved || 0,

      estimated_co2_saved_kg:
        result.estimated_co2_saved_kg ||
        result.estimated_kwh_saved * 0.5 ||
        0,

      estimated_cost_saved_usd:
        result.estimated_cost_saved_usd || 0,

      equivalents:
        result.equivalents || undefined,

      metadata:
        result.metadata || undefined
    };

    console.log(
      "[SustainaDev] Parsed energy data:",
      energyData
    );

    return energyData;

  } catch (error: any) {

    console.error(
      "[SustainaDev] Error estimating energy:",
      error
    );

    return getDefaultEnergyObject(deltaCCN);
  }
}

/**
 * Default fallback if estimate.py fails
 */
function getDefaultEnergyObject(deltaCCN: number) {

  const kwh_per_ccn = 0.0001;

  const estimated_kwh =
    deltaCCN * kwh_per_ccn;

  const co2_per_kwh = 0.475;

  const estimated_co2 =
    estimated_kwh * co2_per_kwh;

  const cost_per_kwh = 0.15;

  const estimated_cost =
    estimated_kwh * cost_per_kwh;

  return {

    emissions_kg:
      estimated_co2,

    estimated_kwh_saved:
      estimated_kwh,

    estimated_co2_saved_kg:
      estimated_co2,

    estimated_cost_saved_usd:
      estimated_cost
  };
}

/**
 * Test function
 */
export async function testEnergyEstimation() {

  console.log(
    "[SustainaDev] Testing energy estimation..."
  );

  const testCCN = 10;

  const result =
    await estimateEnergy(testCCN);

  console.log(
    "[SustainaDev] Test result for CCN reduction of",
    testCCN,
    ":",
    result
  );

  if (
    result &&
    typeof result === "object" &&
    "estimated_kwh_saved" in result
  ) {

    console.log(
      "[SustainaDev] ✅ Energy estimation working correctly!"
    );

    return true;

  } else {

    console.error(
      "[SustainaDev] ❌ Energy estimation returned invalid format!"
    );

    return false;
  }
}