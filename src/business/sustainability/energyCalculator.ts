/**
 * Convert power draw over time into energy consumption.
 *
 * Formula: Energy (J) = Power (W) × Time (s)
 *          Energy (kWh) = Energy (J) / 3,600,000
 *
 * PSU efficiency correction converts DC component watts to AC wall watts:
 *   wallWatts = dcWatts / efficiency
 *
 * Laptop PSUs:  ~87% efficiency at typical load (80 PLUS / Cybenetics laptop studies)
 * Desktop PSUs: ~92% efficiency at 50% load  (80 PLUS Gold, market standard since 2018)
 *   Source: https://www.cybenetics.com/index.php?option=database&params=1,0,22
 *   Source: https://www.plugloadsolutions.com/80PlusPowerSupplies.aspx
 *
 * For laptops: 80 PLUS / Cybenetics laptop PSU efficiency studies (85–90% typical)
 *   Source: https://www.nrdc.org/resources/laptops-energy-use (NRDC 2020, p.14)
 *
 * @param powerWatts      - Average DC power draw in watts during the window
 * @param runtimeSeconds  - Duration of the window in seconds
 * @param applyPsuFactor  - If true (default), correct for PSU efficiency loss
 * @param efficiency      - PSU efficiency to use (defaults to PSU_EFFICIENCY for laptops)
 * @returns Energy consumed in kilowatt-hours (kWh) at the wall
 */

/** Typical laptop PSU efficiency (DC output / AC input). Source: 80 PLUS / Cybenetics. */
export const PSU_EFFICIENCY = 0.87;

/**
 * Typical desktop PSU efficiency at 50% load (80 PLUS Gold — market standard since 2018).
 * Source: https://www.cybenetics.com/index.php?option=database&params=1,0,22
 */
export const PSU_EFFICIENCY_DESKTOP = 0.92;

export function calculateEnergy(
  powerWatts: number,
  runtimeSeconds: number,
  applyPsuFactor = true,
  efficiency: number = PSU_EFFICIENCY
): number {
  const wallWatts = applyPsuFactor ? powerWatts / efficiency : powerWatts;
  const energyJoules = wallWatts * runtimeSeconds;
  return energyJoules / 3_600_000;
}