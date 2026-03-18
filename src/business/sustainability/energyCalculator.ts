export function calculateEnergy(
  powerWatts: number,
  cpuUtilization: number,
  runtimeSeconds: number
): number {

  const energyJoules =
    powerWatts *
    cpuUtilization *
    runtimeSeconds

  const energyKwh =
    energyJoules / 3600000

  return energyKwh
}