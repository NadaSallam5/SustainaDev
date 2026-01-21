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

  if (!facts.callsSelf) {
    return OptimizationStrategy.KEEP_RECURSION;
  }

  if (facts.isLinearRecursion) {
    return OptimizationStrategy.ITERATIVE_REWRITE;
  }

  if (facts.hasOverlappingSubproblems) {
    return OptimizationStrategy.MEMOIZATION;
  }

  return OptimizationStrategy.KEEP_RECURSION;
}

