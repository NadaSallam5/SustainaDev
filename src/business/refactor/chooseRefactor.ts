import { MethodFacts } from "../types";

export function chooseRefactor(facts: MethodFacts) {
  // 🔥 1. Recursion smell
  if (facts.callsSelf) {
    return { type: "RECURSION", reason: "Recursive method detected" };
  }

  // 🔥 2. Nested loops smell
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

  // 🔥 4. Duplicate expensive call smell
  if (facts.hasDuplicateComputation) {
    return {
      type: "DUPLICATE_COMPUTATION",
      reason: "Method repeats the same expensive call.",
    };
  }

  // 🔥 5. String concatenation inside loop smell
  if (facts.hasStringConcatInLoop) {
    return {
      type: "STRING_CONCAT",
      reason: "String concatenation inside a loop causes O(n^2).",
    };
  }

  // Default fallback
  return { type: "GENERAL", reason: "General optimization" };
}
