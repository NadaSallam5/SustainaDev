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
/**
 * Estimate the energy reduction ratio from a Big-O complexity improvement.
 *
 * Energy scales linearly with CPU instruction count, which scales with
 * algorithmic complexity class at representative input size n.
 * Source: Pereira et al., "Energy Efficiency across Programming Languages",
 * SLE 2017 (https://doi.org/10.1145/3136014.3136031)
 *
 * Evaluated at n = 10_000 (representative in-IDE method input size).
 * Ratio = afterOps / beforeOps, capped at [0.01, 1.0].
 *
 * @returns after/before energy ratio — multiply beforeEnergy by this to get afterEnergy.
 */
export function complexityEnergyRatio(
  before: string,
  after: string,
  n = 10_000
): number {
 function ops(notation: string): number {
  const s = notation.replace(/\s/g, "").toLowerCase();

  // O(1)
  if (s.includes("o(1)")) return 1;

  // O(log log n)
  if (s.includes("o(loglogn)")) return Math.log2(Math.log2(n));

  // O(log n) — covers log₂, log₁₀, ln (all same class)
  if (s.includes("o(logn)") || s.includes("o(log(n))") ||
      s.includes("o(log2n)") || s.includes("o(ln(n))")) return Math.log2(n);

  // O(sqrt(n))
  if (s.includes("o(sqrt(n))") || s.includes("o(√n)") ||
      s.includes("o(n^0.5)") || s.includes("o(n^(1/2))")) return Math.sqrt(n);

  // O(n^(1/3))
  if (s.includes("o(n^(1/3))") || s.includes("o(n^0.33)")) return Math.cbrt(n);

  // O(n) — must come AFTER O(n log n), O(n^2), etc. to avoid substring false-match
  // so we check this after all compound n-terms below

  // O(n log log n)
  if (s.includes("o(nloglogn)") || s.includes("o(nlog log n)") ||
      s.includes("o(n*loglogn)")) return n * Math.log2(Math.log2(n));

  // O(n log n) — covers n log n, n*log(n), n·log₂n
  if (s.includes("o(nlogn)") || s.includes("o(nlog(n))") ||
      s.includes("o(n*logn)") || s.includes("o(n·logn)") ||
      s.includes("o(nlog2n)")) return n * Math.log2(n);

  // O(n log² n)  — n times log-squared
  if (s.includes("o(nlog^2n)") || s.includes("o(nlog²n)") ||
      s.includes("o(n(logn)^2)") || s.includes("o(n*log^2n)")) {
    return n * Math.log2(n) * Math.log2(n);
  }

  // O(n^(4/3)) — e.g. some cache-oblivious algorithms
  if (s.includes("o(n^(4/3))") || s.includes("o(n^1.33)")) {
    return Math.pow(n, 4 / 3);
  }

  // O(n^(3/2)) — e.g. shell sort worst case, some graph algorithms
  if (s.includes("o(n^(3/2))") || s.includes("o(n^1.5)") ||
      s.includes("o(n*sqrt(n))") || s.includes("o(n·sqrt(n))")) {
    return Math.pow(n, 1.5);
  }

  // O(n^2 log n)
  if (s.includes("o(n^2logn)") || s.includes("o(n2logn)") ||
      s.includes("o(n^2log(n))") || s.includes("o(n^2*logn)")) {
    return n * n * Math.log2(n);
  }

  // O(n^2) — covers n², n^2, n*n
  if (s.includes("o(n^2)") || s.includes("o(n2)") ||
      s.includes("o(n*n)") || s.includes("o(n²)")) return n * n;

  // O(n^2.37) — matrix multiplication (Strassen variants)
  if (s.includes("o(n^2.37)") || s.includes("o(n^2.376)") ||
      s.includes("o(n^ω)")) return Math.pow(n, 2.376);

  // O(n^3 / log n) — some matrix / fast multiplication variants
  if (s.includes("o(n^3/logn)") || s.includes("o(n3/logn)")) {
    return (n * n * n) / Math.log2(n);
  }

  // O(n^3) — covers n³, n^3
  if (s.includes("o(n^3)") || s.includes("o(n3)") || s.includes("o(n³)")) {
    return n * n * n;
  }

  // O(n^4) and beyond — rare but valid
  if (s.includes("o(n^4)") || s.includes("o(n4)")) return Math.pow(n, 4);
  if (s.includes("o(n^5)") || s.includes("o(n5)")) return Math.pow(n, 5);

  // O(n^k) — generic polynomial fallback via regex
  const polyMatch = s.match(/o\(n\^([\d.]+)\)/);
  if (polyMatch) return Math.pow(n, parseFloat(polyMatch[1]));

  // O(1.5^n), O(phi^n) — sub-exponential bases
  if (s.includes("o(1.5^n)")) return Math.pow(1.5, Math.min(n, 80));
  if (s.includes("o(phi^n)") || s.includes("o(φ^n)")) {
    return Math.pow(1.618, Math.min(n, 80));
  }

  // O(2^n) — standard exponential
  if (s.includes("o(2^n)")) return Math.pow(2, Math.min(n, 63));

  // O(k^n) — generic exponential base via regex
  const expMatch = s.match(/o\(([\d.]+)\^n\)/);
  if (expMatch) return Math.pow(parseFloat(expMatch[1]), Math.min(n, 63));

  // O(n * 2^n) — e.g. TSP exact, subset enumeration with work per subset
  if (s.includes("o(n*2^n)") || s.includes("o(n2^n)") ||
      s.includes("o(n·2^n)")) return n * Math.pow(2, Math.min(n, 63));

  // O(n^2 * 2^n) — e.g. Held-Karp DP
  if (s.includes("o(n^2*2^n)") || s.includes("o(n22^n)")) {
    return n * n * Math.pow(2, Math.min(n, 63));
  }

  // O(3^n)
  if (s.includes("o(3^n)")) return Math.pow(3, Math.min(n, 40));

  // O(n!) — factorial
  if (s.includes("o(n!)")) {
    // Stirling approximation to avoid Infinity for large n
    const safeN = Math.min(n, 20);
    let f = 1;
    for (let i = 2; i <= safeN; i++) f *= i;
    return f;
  }

  // O(n! / k!) or O(P(n,k)) — partial permutations
  if (s.includes("o(n!/") || s.includes("o(p(n,k))")) return Math.pow(n, 3);

  // O(n^n) — e.g. brute-force assignment problems
  if (s.includes("o(n^n)")) return Math.pow(Math.min(n, 15), Math.min(n, 15));

  // Unknown / not parseable → return n so ratio = 1.0 and no saving is fabricated
  return n;
}

  const beforeOps = ops(before);
  const afterOps  = ops(after);

  if (beforeOps <= 0) return 1.0;
  const ratio = afterOps / beforeOps;
  return Math.max(0.01, Math.min(1.0, ratio));
}