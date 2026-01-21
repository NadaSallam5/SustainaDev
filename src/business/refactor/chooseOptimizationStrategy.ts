import { MethodFacts } from "../types";

export enum OptimizationStrategy {
  ITERATIVE_REWRITE = "ITERATIVE_REWRITE",
  MEMOIZATION = "MEMOIZATION",
  STRING_BUILDER = "STRING_BUILDER",
  DUPLICATE_COMPUTATION = "DUPLICATE_COMPUTATION",
  NESTED_LOOPS = "NESTED_LOOPS", // ✅ NEW
  KEEP_RECURSION = "KEEP_RECURSION",
}

export function chooseOptimizationStrategy(
  facts: MethodFacts
): OptimizationStrategy {

  // 🔥 String concat in loop
  if (facts.hasStringConcatInLoop) {
    return OptimizationStrategy.STRING_BUILDER;
  }

  // ✅ Duplicate computation (same call repeated)
  if (facts.hasDuplicateComputation) {
    return OptimizationStrategy.DUPLICATE_COMPUTATION;
  }

  // ✅ Nested loops (O(n^2) pattern)
  if (facts.maxLoopDepth >= 2) {
    return OptimizationStrategy.NESTED_LOOPS;
  }

  // 🔥 Fibonacci-style recursion (highest priority)
  if (facts.hasOverlappingSubproblems) {
    return OptimizationStrategy.MEMOIZATION;
  }

  // 🔁 Linear recursion → iterative
  if (facts.isLinearRecursion) {
    return OptimizationStrategy.ITERATIVE_REWRITE;
  }

  return OptimizationStrategy.KEEP_RECURSION;
}