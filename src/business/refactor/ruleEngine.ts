import { UniversalFeatures } from "../types/universalFeatures";

/**
 * The 5 supported sustainability refactoring strategies.
 * This is the single source of truth for all strategy names in the pipeline.
 */
export enum OptimizationStrategy {
  ITERATIVE_REWRITE = "ITERATIVE_REWRITE", // Recursion → iterative loop
  STRING_BUILDER    = "STRING_BUILDER",    // String concat in loop → builder
  NESTED_LOOPS      = "NESTED_LOOPS",      // O(N^2) loops → HashMap lookup
  SORTING_IN_LOOP   = "SORTING_IN_LOOP",   // Sort inside loop → hoist outside
  SORTING           = "SORTING",    
         // Sort → linear scan if possible
}

/**
 * Single rule-based strategy detector.
 * Takes precomputed UniversalFeatures and returns the applicable strategy, or null.
 * This is the ONLY place in the codebase where a strategy decision is made.
 */
export function detectByRules(features: UniversalFeatures): OptimizationStrategy | null {
  // 1) Sorting inside a loop — worst case: O(N log N × N)
  if (features.sortingInsideLoop)
    return OptimizationStrategy.SORTING_IN_LOOP;

  // 2) Nested loops — O(N²). Check BEFORE string concat: algorithmic severity wins.
  if (features.loopDepth >= 2)
    return OptimizationStrategy.NESTED_LOOPS;

  // 3) String concatenation in a loop — O(N) memory churn
  if (features.stringConcatInLoop)
    return OptimizationStrategy.STRING_BUILDER;

  // 4) General sorting call — may be replaceable with linear scan
  if (features.sortingCalls > 0)
    return OptimizationStrategy.SORTING;

  // 5) Recursion — rewrite to iterative to eliminate stack overhead
  if (features.recursion)
    return OptimizationStrategy.ITERATIVE_REWRITE;

  return null;
}