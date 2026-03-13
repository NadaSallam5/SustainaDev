import { getHardwareSpecs, estimateHardwarePower } from "./powerEstimator"
import { measureExecution } from "../codeCarbon"
import { calculateEnergy } from "./energyCalculator"
import { calculateCarbon } from "./carbonCalculator"
import { calculateSustainabilityScore } from "./sustainabilityScore"

export async function analyzeSustainability(startTime: number) {

  const hardware = await getHardwareSpecs()

  const power = estimateHardwarePower(hardware)

  const metrics = await measureExecution(startTime)

  const energy = calculateEnergy(
    power,
    metrics.cpuUtilization,
    metrics.runtimeSeconds
  )

  const carbon = calculateCarbon(energy)

  const score = calculateSustainabilityScore(carbon)

  return {
    energyKwh: energy,
    carbonGrams: carbon,
    sustainabilityScore: score
  }

}