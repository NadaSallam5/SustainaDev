import { MethodFacts } from "../types";

export enum OptimizationStrategy {
  ITERATIVE_REWRITE = "ITERATIVE_REWRITE",
  MEMOIZATION = "MEMOIZATION",
  STRING_BUILDER = "STRING_BUILDER",
  DUPLICATE_COMPUTATION = "DUPLICATE_COMPUTATION",
  NESTED_LOOPS = "NESTED_LOOPS",
  SORTING_IN_LOOP = "SORTING_IN_LOOP",   // ✅ NEW
  SORTING = "SORTING",                   // ✅ NEW (optional but useful)
  KEEP_RECURSION = "KEEP_RECURSION",
}

export function chooseOptimizationStrategy(
  facts: MethodFacts
): OptimizationStrategy {
  // 1) Nested loops → O(n^2) — biggest algorithmic win
  if (facts.maxLoopDepth >= 2) {
    return OptimizationStrategy.NESTED_LOOPS;
  }

  // 2) Sorting inside a loop → O(n^2 log n)  smell
  if (facts.sortInsideLoop === true) {
    return OptimizationStrategy.SORTING_IN_LOOP;
  }

  // 3) Sorting anywhere → O(n log n) — worth flagging
  if (facts.hasSortingCall === true) {
    return OptimizationStrategy.SORTING;
  }

  // 4) String concat in a loop → GC pressure
  if (facts.hasStringConcatInLoop === true) {
    return OptimizationStrategy.STRING_BUILDER;
  }

  // 5) Fibonacci-style recursion → memoization candidate
  if (facts.hasOverlappingSubproblems === true) {
    return OptimizationStrategy.MEMOIZATION;
  }

  // 6) Linear recursion → convert to iterative
  if (facts.isLinearRecursion === true) {
    return OptimizationStrategy.ITERATIVE_REWRITE;
  }

  // 7) No optimization available
  return OptimizationStrategy.KEEP_RECURSION;
}
