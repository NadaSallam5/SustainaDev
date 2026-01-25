import { MethodFacts } from "../types";

export enum OptimizationStrategy {
  ITERATIVE_REWRITE = "ITERATIVE_REWRITE",
  MEMOIZATION = "MEMOIZATION",
  STRING_BUILDER = "STRING_BUILDER",

  NESTED_LOOPS = "NESTED_LOOPS",
  SORTING_IN_LOOP = "SORTING_IN_LOOP",   // ✅ NEW
  SORTING = "SORTING",                   // ✅ NEW (optional but useful)
  KEEP_RECURSION = "KEEP_RECURSION",
}

export function chooseOptimizationStrategy(
  facts: MethodFacts
): OptimizationStrategy {

  // ✅ 1) STRING CONCAT —
  if (facts.hasStringConcatInLoop === true) {
    return OptimizationStrategy.STRING_BUILDER;
  }




  // ✅ 3) SORTING inside loop (NEW)
  if (facts.sortInsideLoop === true) {
    return OptimizationStrategy.SORTING_IN_LOOP;
  }

  // ✅ 4) SORTING detected (NEW)
  if (facts.hasSortingCall === true) {
    return OptimizationStrategy.SORTING;
  }

  // ✅ 5) Nested loops → O(n^2)
  if (facts.maxLoopDepth >= 2) {
    return OptimizationStrategy.NESTED_LOOPS;
  }

  // ✅ 6) Fibonacci-style recursion
  if (facts.hasOverlappingSubproblems === true) {
    return OptimizationStrategy.MEMOIZATION;
  }

  // ✅ 7) Linear recursion
  if (facts.isLinearRecursion === true) {
    return OptimizationStrategy.ITERATIVE_REWRITE;
  }

  // ❗ 8) No optimization available
  return OptimizationStrategy.KEEP_RECURSION;
}