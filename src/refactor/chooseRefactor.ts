import { FunctionMetrics } from "../types";

/**
 * Decides which refactor type fits this function based on metrics + code smell patterns.
 */
export function decideRefactorType(func: FunctionMetrics) {
  const { name, ccn, nloc, tokenCount = 0, callCount = 1, content = "" } = func;

  // --- NEW: Detect possible rename candidates ---
  /*  const badNames = ["x", "y", "z", "a", "b", "data", "info", "temp"];
  const found = badNames.find((n) => new RegExp(`\\b${n}\\b`).test(content));
 */
  /* if (true) {
    return {
      type: "Rename Variable",
      reason: `Variable  may be unclear. Suggest renaming it.`,
    };
  } */
  // Metric-based rules
  if (ccn > 10 || nloc > 40) {
    return {
      type: "Extract Method",
      reason: `Function "${name}" is too large or complex (CCN=${ccn}, NLOC=${nloc}).`,
    };
  }

  if (ccn <= 3 && nloc < 10 && callCount <= 2) {
    return {
      type: "Inline Method",
      reason: `Function "${name}" is trivial and rarely reused (CCN=${ccn}, NLOC=${nloc}, calls=${callCount}).`,
    };
  }

  // Smell-based heuristics
  const code = content?.toLowerCase() ?? "";

  if (/(print|log).*(calculate|update|process)/.test(code)) {
    return {
      type: "Extract Method",
      reason: `Function "${name}" mixes I/O with logic — consider extraction for clarity.`,
    };
  }

  if (/return\s+\w+\(.*\);/.test(code) && nloc <= 5) {
    return {
      type: "Inline Method",
      reason: `Function "${name}" just delegates to another method — safe to inline.`,
    };
  }

  return {
    type: "Extract Method",
    reason: `Function "${name}" moderately complex (CCN=${ccn}), extracting will improve readability.`,
  };
}
