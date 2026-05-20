export interface HardwareSpecs {
  cpuModel: string;
  gpuModel?: string;
  cpuTdp: number;
  gpuTdp?: number;
  platform: "win32" | "darwin" | "linux";
  /** RAM installed in GB — used for dynamic base power calculation */
  ramGb: number;
  /** True if the TDP value came from a real hardware measurement or the DB, false if estimated */
  tdpIsEstimated: boolean;
}

export interface ExecutionMetrics {
  runtimeSeconds: number;
  /** 0–1 average CPU utilization measured CONCURRENTLY during execution */
  cpuUtilization: number;
  averagePowerWatts?: number;
}

export interface SustainabilityResult {
  /** Energy consumed at the wall (after PSU efficiency correction) in kWh */
  energyKwh: number;
  /** CO₂ emissions in grams, using grid intensity for detected country */
  carbonGrams: number;
  runtimeSeconds: number;
  /** DC power draw in watts as reported by sensor or TDP model */
  powerWatts: number;
  /** True = hardware sensor reading (RAPL / powermetrics); false = TDP-based model */
  isRealMeasurement: boolean;
  /** ISO 3166-1 alpha-2 country code used for carbon intensity, or undefined = global average */
  countryCode: string | undefined;
  /** gCO₂/kWh grid carbon intensity that was applied */
  gridIntensity: number;
  /**
   * PSU efficiency factor applied to convert DC watts to wall watts.
   * Laptop: 0.87 (80 PLUS / Cybenetics laptop studies)
   * Desktop: 0.92 (80 PLUS Gold at 50% load — market standard since 2018)
   */
  psuEfficiency: number;
}