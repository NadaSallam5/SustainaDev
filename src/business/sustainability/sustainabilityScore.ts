export function calculateSustainabilityScore(
  carbonGrams: number
): number {

  const worstCaseCarbon = 500

  const score =
    100 - (carbonGrams / worstCaseCarbon) * 100

  return Math.max(0, score)
}