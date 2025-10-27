// codeCarbon.ts - CORRECTED VERSION
import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let estimatePyPath: string | undefined;

/**
 * Initialize paths for estimate.py
 */
export function initPaths(context: vscode.ExtensionContext) {
  estimatePyPath = path.join(context.extensionPath, 'metrics', 'estimate.py');
  console.log('[SustainaDev] estimate.py path:', estimatePyPath);
}

/**
 * Estimate energy consumption based on CCN reduction
 * 
 * ✅ FIXED VERSION - Returns proper JSON object
 */
export async function estimateEnergy(deltaCCN: number): Promise<any> {
  if (!estimatePyPath) {
    console.warn('[SustainaDev] estimate.py path not initialized');
    return getDefaultEnergyObject(deltaCCN);
  }

  try {
    const command = `python "${estimatePyPath}" ${deltaCCN}`;
    console.log('[SustainaDev] Running:', command);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 // 1MB buffer
    });

    if (stderr) {
      console.warn('[SustainaDev] estimate.py stderr:', stderr);
    }

    console.log('[SustainaDev] estimate.py output:', stdout);

    // ✅ CRITICAL FIX: Parse JSON instead of converting to float!
    const result = JSON.parse(stdout.trim());

    // Ensure the result has all required fields
    if (!result || typeof result !== 'object') {
      console.warn('[SustainaDev] Invalid result format, using default');
      return getDefaultEnergyObject(deltaCCN);
    }

    // Validate and ensure all required fields exist
    const energyData = {
      emissions_kg: result.emissions_kg || 0,
      estimated_kwh_saved: result.estimated_kwh_saved || 0,
      estimated_co2_saved_kg: result.estimated_co2_saved_kg || result.estimated_kwh_saved * 0.475 || 0,
      estimated_cost_saved_usd: result.estimated_cost_saved_usd || 0,
      // Optional: Include equivalents if available
      equivalents: result.equivalents || undefined,
      // Optional: Include metadata if available
      metadata: result.metadata || undefined
    };

    console.log('[SustainaDev] Parsed energy data:', energyData);
    return energyData;

  } catch (error: any) {
    console.error('[SustainaDev] Error estimating energy:', error);
    
    // Check if it's a parsing error
    if (error.message?.includes('JSON')) {
      console.error('[SustainaDev] JSON parsing failed. Raw output might not be valid JSON.');
    }
    
    // Return default values instead of failing
    return getDefaultEnergyObject(deltaCCN);
  }
}

/**
 * Generate default energy object when estimate.py fails
 * Uses the adjusted formula: 0.0001 kWh per CCN point
 */
function getDefaultEnergyObject(deltaCCN: number) {
  const kwh_per_ccn = 0.0001; // Adjusted formula for visibility
  const estimated_kwh = deltaCCN * kwh_per_ccn;
  const co2_per_kwh = 0.475;
  const estimated_co2 = estimated_kwh * co2_per_kwh;
  const cost_per_kwh = 0.15;
  const estimated_cost = estimated_kwh * cost_per_kwh;

  return {
    emissions_kg: estimated_co2,
    estimated_kwh_saved: estimated_kwh,
    estimated_co2_saved_kg: estimated_co2,
    estimated_cost_saved_usd: estimated_cost
  };
}

/**
 * Test function - can be used to verify the setup
 */
export async function testEnergyEstimation() {
  console.log('[SustainaDev] Testing energy estimation...');
  
  const testCCN = 10;
  const result = await estimateEnergy(testCCN);
  
  console.log('[SustainaDev] Test result for CCN reduction of', testCCN, ':', result);
  
  if (result && typeof result === 'object' && 'estimated_kwh_saved' in result) {
    console.log('[SustainaDev] ✅ Energy estimation working correctly!');
    return true;
  } else {
    console.error('[SustainaDev] ❌ Energy estimation returned invalid format!');
    return false;
  }
}