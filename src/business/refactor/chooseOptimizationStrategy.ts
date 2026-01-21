import { MethodFacts } from "../types";

export enum OptimizationStrategy {
ITERATIVE_REWRITE = "ITERATIVE_REWRITE",
  MEMOIZATION = "MEMOIZATION",
 STRING_BUILDER = "STRING_BUILDER", // 👈 جديد
  KEEP_RECURSION = "KEEP_RECURSION",
}
export function chooseOptimizationStrategy(
  facts: MethodFacts
): OptimizationStrategy {

  // 🔥 String concat in loop
  if (facts.hasStringConcatInLoop) {
    return OptimizationStrategy.STRING_BUILDER;
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
