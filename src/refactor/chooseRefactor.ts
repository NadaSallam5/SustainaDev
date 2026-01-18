import { FunctionMetrics } from "../types";

/**
 * Decides which refactor type fits this function based on algorithmic efficiency and energy consumption.
 */
export function decideRefactorType(func: FunctionMetrics) {
  const { name, ccn, nloc, callCount = 1, content = "" } = func;

  // --- 1. Detect possible rename candidates (Kept for clarity) ---
  const badNames = ["p", "t"];
  const found = badNames.find((n) => new RegExp(`\\b${n}\\b`).test(content));

  if (found) {
    return {
      type: "Rename Variable",
      reason: `Variable "${found}" in "${name}" is non-descriptive. Suggest renaming it.`,
      candidate: found,
    };
  }

  // --- 2. Algorithmic Optimization Check (O(N^2) Pattern) ---
  // Specifically targets nested loops that can be optimized to O(N) using HashMaps
  const nestedLoopPattern = /(for|while).*\{[\s\S]*?(for|while)/;
  if (nestedLoopPattern.test(content)) {
    return {
      type: "Algorithmic Optimization",
      reason: `Function "${name}" contains nested loops ($O(N^2)$). Optimizing this to $O(N)$ will reduce CPU cycles and energy consumption.`,
    };
  }

  // --- 3. High Complexity Optimization ---
  // If CCN or NLOC is high, trigger an optimization check even without a clear nested loop pattern
  if (ccn > 10 || nloc > 40) {
    return {
      type: "Algorithmic Optimization",
      reason: `Function "${name}" has high logical complexity (CCN=${ccn}). Analyzing for algorithmic inefficiencies to improve execution footprint.`,
    };
  }

  // --- 4. Inline Method Check (Efficiency-focused) ---
  // Inlining small methods reduces call-stack overhead and improves execution performance
  if (ccn <= 2 && nloc < 10 && callCount <= 2) {
    return {
      type: "Inline Method",
      reason: `Function "${name}" is trivial. Inlining reduces unnecessary abstraction and improves execution efficiency.`,
    };
  }

  const code = content?.toLowerCase() ?? "";
  if (/return\s+\w+\(.*\);/.test(code) && nloc <= 5) {
    return {
      type: "Inline Method",
      reason: `Function "${name}" is a simple delegate. Safe to inline for better performance.`,
    };
  }

  // Default: Return as Algorithmic Optimization if it's moderately complex
  return {
    type: "Algorithmic Optimization",
    reason: `Function "${name}" (CCN=${ccn}) analyzed for algorithmic improvements to lower energy consumption.`,
  };
}