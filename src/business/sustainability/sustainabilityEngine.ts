// ─── REPLACE your entire sustainabilityEngine.ts with this ───
import { getHardwareSpecs, estimateHardwarePower } from "./powerEstimator";
import { measureExecution } from "../codeCarbon";
import { calculateEnergy } from "./energyCalculator";
import { calculateCarbon } from "./carbonCalculator";

export async function analyzeSustainability(startTime: number) {
  const hardware = await getHardwareSpecs();

  const metrics = await measureExecution(startTime);

  // cpuUtilization now flows into power estimation, not energy calculation
  const power = estimateHardwarePower(hardware, metrics.cpuUtilization);

  const energy = calculateEnergy(power, metrics.runtimeSeconds);

  const carbon = calculateCarbon(energy);

  return {
    energyKwh: energy,
    carbonGrams: carbon,
     // computed externally once before+after are both known
  };
}