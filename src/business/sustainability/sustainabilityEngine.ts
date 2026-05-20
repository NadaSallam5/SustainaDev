import { getHardwareSpecs, measureRealPower, measureCpuUtilizationConcurrent } from "./powerEstimator";
import { calculateEnergy } from "./energyCalculator";
import { calculateCarbon, detectCountryCode, getIntensity } from "./carbonCalculator";
import { ExecutionMetrics } from "./types";
import si from "systeminformation";
import { PSU_EFFICIENCY, PSU_EFFICIENCY_DESKTOP } from "./energyCalculator";

/**
 * Run a measurable work function and compute its sustainability impact.
 * 
 * @param workFn - The actual code to measure. Must be async.
 * @returns energy in kWh and carbon in grams for that execution window.
 */
export async function measureWorkSustainability(
  workFn: () => Promise<void>
): Promise<{
  energyKwh: number;
  carbonGrams: number;
  runtimeSeconds: number;
  powerWatts: number;
  isRealMeasurement: boolean;
  countryCode: string | undefined;
  gridIntensity: number;
  psuEfficiency: number;
}> {
  const hardware = await getHardwareSpecs();
  const countryCode = detectCountryCode();
  const isDesktop = hardware.cpuTdp >= 65 && !hardware.platform.includes("darwin");

  // ── Strategy A: energy-counter snapshot (Linux RAPL / macOS IOReport) ──
  // Take a joule-level snapshot BEFORE and AFTER work.
  // This is the only method that correctly attributes energy to the work window.
  // No sampling window needed — we just diff the counters.
  const raplSnapshot = hardware.platform === "linux"
    ? await takeRaplSnapshot()
    : null;

  // ── Concurrent CPU sampling starts NOW, before work ──
  // We don't know duration ahead of time, so we poll until work ends.
  let cpuUtilization = 0.5;
  let workDone = false;

  const cpuSamplerPromise = (async () => {
    // Discard stale first reading
    await si.currentLoad();
    const samples: number[] = [];
    while (!workDone) {
      await new Promise(r => setTimeout(r, 150));
      if (workDone) break;
      try {
        const load = await si.currentLoad();
        samples.push(load.currentLoad / 100);
      } catch { /* ignore transient */ }
    }
    if (samples.length === 0) return 0.5;
    if (samples.length >= 4) {
      samples.sort((a, b) => a - b);
      samples.splice(0, 1);
      samples.splice(-1, 1);
    }
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  })();

  const start = Date.now();
  await workFn();
  workDone = true;
  const runtimeMs = Date.now() - start;
  const runtimeSeconds = runtimeMs / 1000;

  cpuUtilization = await cpuSamplerPromise;

  // ── Strategy A result: RAPL energy delta ──
  if (raplSnapshot !== null) {
    const afterSnapshot = await takeRaplSnapshot();
    if (afterSnapshot !== null && afterSnapshot > raplSnapshot) {
      const joulesFromRapl = (afterSnapshot - raplSnapshot) / 1_000_000; // µJ → J
      const psuEfficiency = isDesktop ? PSU_EFFICIENCY_DESKTOP : PSU_EFFICIENCY;
      const wallJoules = joulesFromRapl / psuEfficiency;
      const energyKwh = wallJoules / 3_600_000;
      const carbonGrams = calculateCarbon(energyKwh, countryCode);
      const powerWatts = wallJoules / runtimeSeconds;
      return {
        energyKwh, carbonGrams, runtimeSeconds,
        powerWatts, isRealMeasurement: true,
        countryCode, gridIntensity: getIntensity(countryCode),
        psuEfficiency,
      };
    }
  }

  // ── Strategy B: TDP model with concurrent utilization ──
  // measureRealPower is called with the ACTUAL runtime so the TDP model
  // uses the correct throttle factor. On macOS it tries powermetrics
  // for a SHORT window (not after work ends) — we accept this is approximate.
  const { watts, isReal } = await measureRealPower(
    hardware,
    cpuUtilization,
    Math.max(runtimeMs, 300),
    runtimeSeconds
  );

  const psuEfficiency = isDesktop ? PSU_EFFICIENCY_DESKTOP : PSU_EFFICIENCY;
  const energyKwh = calculateEnergy(watts, runtimeSeconds, true, psuEfficiency);
  const carbonGrams = calculateCarbon(energyKwh, countryCode);
  const gridIntensity = getIntensity(countryCode);

  return {
    energyKwh, carbonGrams, runtimeSeconds,
    powerWatts: watts, isRealMeasurement: isReal,
    countryCode, gridIntensity,
    psuEfficiency,
  };
}

/**
 * Read the current RAPL energy counter in µJ across all known paths.
 * Returns null if no readable RAPL path exists.
 * Used for before/after snapshots — NOT for timed sampling.
 */
async function takeRaplSnapshot(): Promise<number | null> {
  const { execSync } = await import("child_process");
  const paths = [
    "/sys/class/powercap/intel-rapl/intel-rapl:0/energy_uj",
    "/sys/class/powercap/amd_energy/amd_energy_pkg/energy_uj",
    "/sys/bus/platform/drivers/amd_energy/amd_energy.0/energy1_input",
  ];
  for (const p of paths) {
    try {
      const val = parseInt(execSync(`cat ${p}`, { timeout: 300 }).toString().trim());
      if (!isNaN(val) && val > 0) return val;
    } catch { /* not available */ }
  }
  return null;
}

/**
 * Legacy wrapper — kept for backward compatibility with extension.ts.
 * Uses a short RAPL snapshot if available; otherwise TDP model.
 * NOTE: startTime must be captured BEFORE the work begins for accurate results.
 */
export async function analyzeSustainability(startTime: number) {
  const hardware = await getHardwareSpecs();
  const runtimeSeconds = (Date.now() - startTime) / 1000;
  const countryCode = detectCountryCode();
  const isDesktop = hardware.cpuTdp >= 65 && !hardware.platform.includes("darwin");
  const psuEff = isDesktop ? PSU_EFFICIENCY_DESKTOP : PSU_EFFICIENCY;

  // Short RAPL snapshot is meaningless post-hoc (work is over).
  // Use utilization-weighted TDP model with actual elapsed runtime.
  const cpuUtilization = await measureCpuUtilizationConcurrent(300);
  const { watts } = await measureRealPower(hardware, cpuUtilization, 300, runtimeSeconds);
  const energyKwh = calculateEnergy(watts, runtimeSeconds, true, psuEff);
  const carbonGrams = calculateCarbon(energyKwh, countryCode);

  return { energyKwh, carbonGrams, countryCode };
}