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

export function chooseOptimizationStrategy(facts: MethodFacts): OptimizationStrategy {

  // 1) String concat
  if (facts.hasStringConcatInLoop === true) {
    return OptimizationStrategy.STRING_BUILDER;
  }

  // 2) Sorting inside loop (more specific first)
  if (facts.sortInsideLoop === true) {
    return OptimizationStrategy.SORTING_IN_LOOP;
  }

  // 3) General sorting
  if (facts.hasSortingCall === true) {
    return OptimizationStrategy.SORTING;
  }

  // 4) Nested loops
  if (facts.maxLoopDepth >= 2) {
    return OptimizationStrategy.NESTED_LOOPS;
  }

  // 5) Fibonacci-style recursion
  if (facts.hasOverlappingSubproblems === true) {
    return OptimizationStrategy.MEMOIZATION;
  }

  // 6) Linear recursion
  if (facts.isLinearRecursion === true) {
    return OptimizationStrategy.ITERATIVE_REWRITE;
  }

  return OptimizationStrategy.KEEP_RECURSION;
}