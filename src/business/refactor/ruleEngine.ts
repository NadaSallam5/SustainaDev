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
export function detectByRules(
  features: UniversalFeatures,
  skipped: Set<string> = new Set()
): OptimizationStrategy | null {
  // Helper: return strategy only if triggered AND not already skipped by user
  const pick = (condition: boolean, strategy: OptimizationStrategy) =>
    condition && !skipped.has(strategy) ? strategy : null;

  // Priority order: worst algorithmic smells first
  return (
    pick(features.sortingInsideLoop,  OptimizationStrategy.SORTING_IN_LOOP)  || // O(N log N × N)
    pick(features.loopDepth >= 2,     OptimizationStrategy.NESTED_LOOPS)     || // O(N²)
    pick(features.stringConcatInLoop, OptimizationStrategy.STRING_BUILDER)   || // O(N) memory churn
    pick(features.sortingCalls > 0,   OptimizationStrategy.SORTING)          || // redundant sort
    pick(features.recursion,          OptimizationStrategy.ITERATIVE_REWRITE)   // stack overhead
  );
}