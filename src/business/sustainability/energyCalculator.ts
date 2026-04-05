// ─── REPLACE your entire energyCalculator.ts with this ───
export function calculateEnergy(
  powerWatts: number,
  runtimeSeconds: number
): number {
  const energyJoules = powerWatts * runtimeSeconds;

  const energyKwh = energyJoules / 3_600_000;

  return energyKwh;
}