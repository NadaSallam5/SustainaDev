// ─── REPLACE your entire sustainabilityScore.ts with this ───
export function calculateSustainabilityScore(
  carbonGramsAfter: number,
  carbonGramsBefore: number
): number {
  // No valid baseline — return neutral score
  if (carbonGramsBefore <= 0) {
    return 50;
  }

  // How much did carbon improve relative to before?
  // +1.0 = perfect elimination, 0 = no change, negative = got worse
  const improvement =
    (carbonGramsBefore - carbonGramsAfter) / carbonGramsBefore;

  // Map to 0–100: 50 = no change, 100 = full elimination, 0 = doubled emissions
  return Math.max(0, Math.min(100, 50 + improvement * 50));
}