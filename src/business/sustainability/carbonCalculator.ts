/*
Carbon intensity source:
Electricity Maps
https://www.electricitymaps.com/
*/

export function calculateCarbon(
  energyKwh: number,
  carbonIntensity = 475
): number {

  const carbon = energyKwh * carbonIntensity

  return carbon
}