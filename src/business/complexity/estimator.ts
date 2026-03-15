import { MethodFacts } from "../types";
import { BigONotation } from "./types";

/**
 * Big-O estimation based ONLY on your existing MethodFacts fields.
 * Adds one important rule:
 * - String concatenation inside a loop behaves like O(n^2) in Java.
 */
export function estimateBigO(f: MethodFacts): BigONotation {
  // ---- recursion ----
  if (f.callsSelf) {
    // Fibonacci-style recursion -> often exponential
    if (f.hasOverlappingSubproblems) return "O(2^n)";

    // One recursive call per frame -> linear
    if (f.isLinearRecursion) return "O(n)";

    // Recursion exists but pattern unknown -> avoid lying
    return "Unknown";
  }

  // 🔥 Special case: String concat inside a single loop
  // In Java, `s = s + i` copies strings repeatedly -> quadratic behavior
  if (f.maxLoopDepth === 1 && f.hasStringConcatInLoop) {
    return "O(n^2)";
  }
 // ✅ Sorting rules (IMPORTANT)
  // sort performed inside a loop => n times sort(n log n) => O(n^2 log n)
  if (f.sortInsideLoop) {
    return "O(n^2 log n)";
  }

  // sort performed once (outside loops or just once overall) => O(n log n)
  if (f.hasSortingCall) {
    return "O(n log n)";
  }

  // ---- loops ----
  if (f.maxLoopDepth >= 3) return "O(n^3)";
  if (f.maxLoopDepth === 2) return "O(n^2)";
  if (f.maxLoopDepth === 1) return "O(n)";

  return "O(1)";
}

/**
 * Space Big-O estimation (for factorial-style recursion).
 *
 * Simple rules:
 * - Linear recursion (like factorial) uses O(n) space بسبب call stack depth.
 * - Other cases default to O(1) extra space in our simplified model.
 *
 * NOTE: This does NOT try to model data-structure memory (e.g., HashSet memory).
 * It is focused on stack/recursion overhead for the factorial case you requested.
 */
export function estimateSpaceBigO(f: MethodFacts): BigONotation {
  // Factorial-style recursion: one recursive call per frame -> stack depth n
  if (f.callsSelf && f.isLinearRecursion && !f.hasOverlappingSubproblems) {
    return "O(n)";
  }

  // Default: constant extra space
  return "O(1)";
}

/**
 * Convert Big-O to a comparable operation estimate.
 * This is an estimate, not runtime measurement.
 */
export function estimateOps(bigO: BigONotation, n: number): number {
  switch (bigO) {
    case "O(1)":
      return 1_000;
    case "O(n)":
      return n * 1_000;
    case "O(n log n)":
      return Math.max(1, Math.round(n * Math.log2(Math.max(2, n)) * 1_000));
    case "O(n^2)":
      return n * n;
       case "O(n^2 log n)":
      return Math.max(
        1,
        Math.round(n * n * Math.log2(Math.max(2, n)))
      );
    case "O(n^3)":
      return n * n * n;
    case "O(2^n)":
      return Math.pow(2, Math.min(n, 30)); // cap for safety
    default:
      return 0;
  }
}

/**
 * Convert operations to time for reporting (relative comparison).
 */
export function estimateTimeMs(ops: number): number {
  const OPS_PER_MS = 50_000;
  return Math.max(1, Math.round(ops / OPS_PER_MS));
}
