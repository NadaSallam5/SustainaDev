export interface HardwareSpecs {
  cpuModel: string
  gpuModel?: string
  cpuTdp: number
  gpuTdp?: number
}

export interface ExecutionMetrics {
  runtimeSeconds: number
  cpuUtilization: number
}

export interface SustainabilityResult {
  energyKwh: number
  carbonGrams: number
  sustainabilityScore: number
}