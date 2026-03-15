import { MethodFacts } from "../types";

export function chooseRefactor(facts: MethodFacts) {
  if (facts.callsSelf) {
    return { type: "RECURSION", reason: "Recursive method detected" };
  }

  if (facts.maxLoopDepth >= 2) {
    return { type: "NESTED_LOOPS", reason: "Nested loops detected" };
  }
  // 🔥 3. Sorting smell (NEW)
  if (facts.hasSortingCall) {
    if (facts.sortInsideLoop) {
      return {
        type: "SORTING_IN_LOOP",
        reason: "Sorting inside a loop causes O(n log n * n).",
      };
    }

    return {
      type: "SORTING",
      reason: "Sorting detected (may require optimization).",
    };
  }

  return { type: "GENERAL", reason: "General optimization" };
}
