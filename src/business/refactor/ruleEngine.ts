import { UniversalFeatures } from "../types/universalFeatures";
import { OptimizationStrategy } from "./chooseOptimizationStrategy";

export function detectByRules(features: UniversalFeatures) {

  if (features.stringConcatInLoop)
    return OptimizationStrategy.STRING_BUILDER;

  if (features.sortingInsideLoop)
    return OptimizationStrategy.SORTING_IN_LOOP;

  if (features.sortingCalls > 0)
    return OptimizationStrategy.SORTING;

  if (features.loopDepth >= 2)
    return OptimizationStrategy.NESTED_LOOPS;

  if (features.recursion)
    return OptimizationStrategy.ITERATIVE_REWRITE;

  return null; // 👈 مهم
}