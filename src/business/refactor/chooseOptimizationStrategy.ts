import { MethodFacts } from "../types";

export enum OptimizationStrategy {
  ITERATIVE_REWRITE = "ITERATIVE_REWRITE",
  MEMOIZATION = "MEMOIZATION",
  KEEP_RECURSION = "KEEP_RECURSION",
}
export function chooseOptimizationStrategy(
  facts: MethodFacts
): OptimizationStrategy {

  // 🔥 NEW: Nested loops optimization
  if (facts.maxLoopDepth >= 2) {
    return OptimizationStrategy.MEMOIZATION; 
    // or a new enum: SET_BASED_OPTIMIZATION لو حابة
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
