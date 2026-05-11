/**
 * evalTypes.ts
 * Unified evaluation result structure for Qwen zero-shot optimization proof.
 * Used across evaluate_qwen.ts → aggregate.ts → generateReport.ts
 */

export type ComplexityClass =
  | "O(1)"
  | "O(log n)"
  | "O(n)"
  | "O(n log n)"
  | "O(n²)"
  | "O(n³)"
  | "O(2^n)"
  | "unknown";

export interface EvalResult {
  /** Dataset task identifier, e.g. "HE-001" or "MBPP-045" */
  taskId: string;

  /** Human-readable description of what the task does */
  taskDescription: string;

  /** Source dataset */
  dataset: "HumanEval" | "MBPP";

  /**
   * Correctness: did Qwen's optimized code preserve original behavior?
   * Verified by running both versions against the same test cases.
   */
  correct: boolean;

  /** Big-O class of the original code */
  originalComplexity: ComplexityClass;

  /** Big-O class of Qwen's output */
  optimizedComplexity: ComplexityClass;

  /**
   * Did Big-O class improve (i.e. move to a strictly lower complexity tier)?
   * false if complexity stayed the same OR got worse.
   */
  complexityImproved: boolean;

  /**
   * Estimated speed improvement as a percentage (0–100).
   * Based on SustainaDev complexityValidator / estimator output.
   * 0 if not improved or task was incorrect.
   */
  speedImprovement: number;

  /**
   * Estimated energy reduction as a percentage (0–100).
   * Sourced from energyCalculator.ts
   */
  energyReduction: number;

  /**
   * Estimated carbon footprint reduction as a percentage (0–100).
   * Sourced from carbonCalculator.ts
   */
  carbonReduction: number;

  /**
   * ISO timestamp of when this evaluation ran.
   * Used for reproducibility and report dating.
   */
  evaluatedAt: string;

  /**
   * Raw error message if Qwen failed to produce valid code.
   * Null on success.
   */
  error: string | null;
}

/** Aggregated summary over all EvalResult entries */
export interface AggregationSummary {
  totalTasks: number;

  /** # tasks where correct === true AND complexityImproved === true */
  successCount: number;

  /** successCount / totalTasks × 100 (rounded to 2dp) */
  successRate: number;

  /** # tasks where correct === true */
  correctCount: number;

  /** correctCount / totalTasks × 100 */
  correctnessRate: number;

  /** # tasks where complexityImproved === true */
  complexityImprovedCount: number;

  /** complexityImprovedCount / totalTasks × 100 */
  complexityImprovementRate: number;

  /** Mean speedImprovement across ALL tasks (including 0s for failures) */
  avgSpeedImprovement: number;

  /** Mean energyReduction across ALL tasks */
  avgEnergyReduction: number;

  /** Mean carbonReduction across ALL tasks */
  avgCarbonReduction: number;

  /** Mean speedImprovement for tasks where correct === true only */
  avgSpeedImprovementCorrectOnly: number;

  generatedAt: string;
}