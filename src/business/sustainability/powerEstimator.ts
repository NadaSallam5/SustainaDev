import si from "systeminformation"
import { HardwareSpecs } from "./types"

/*
Sources for TDP values:
Intel ARK
https://ark.intel.com/

NVIDIA GPU specs
https://www.nvidia.com/
*/

const cpuTdpDatabase: Record<string, number> = {
  "Intel(R) Core(TM) i7-12700K": 125,
  "Intel(R) Core(TM) i5-12400F": 65
}

const gpuTdpDatabase: Record<string, number> = {
  "NVIDIA GeForce RTX 3060": 170,
  "NVIDIA GeForce RTX 3070": 220
}

export async function getHardwareSpecs(): Promise<HardwareSpecs> {

  const cpu = await si.cpu()
  const graphics = await si.graphics()

  const cpuModel = cpu.brand
  const gpuModel = graphics.controllers[0]?.model

  const cpuTdp = cpuTdpDatabase[cpuModel] ?? 65
  const gpuTdp = gpuModel ? gpuTdpDatabase[gpuModel] ?? 0 : 0

  return {
    cpuModel,
    gpuModel,
    cpuTdp,
    gpuTdp
  }
}

export function estimateHardwarePower(specs: HardwareSpecs): number {

  const baseSystemPower = 30

  const totalPower =
    specs.cpuTdp +
    (specs.gpuTdp ?? 0) +
    baseSystemPower

  return totalPower
}