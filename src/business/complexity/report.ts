import { AIComplexityResult, OptimizationReport } from "./types";

export function buildOptimizationReport(
  beforeAI: AIComplexityResult,
  afterAI: AIComplexityResult,
  beforeFacts?: any,
  afterFacts?: any
): OptimizationReport {
  const isSingleRecursionCase =
    beforeFacts?.callsSelf === true &&
    beforeFacts?.isLinearRecursion === true &&
    beforeFacts?.hasOverlappingSubproblems === false &&
    afterFacts?.callsSelf === false;

  if (isSingleRecursionCase) {
    return {
      metric: "space",
      before: beforeAI.spaceComplexity,
      after: afterAI.spaceComplexity,
      improvement: `From ${beforeAI.spaceComplexity} → ${afterAI.spaceComplexity}`,
    };
  }

  return {
    metric: "time",
    before: beforeAI.timeComplexity,
    after: afterAI.timeComplexity,
    improvement: `From ${beforeAI.timeComplexity} → ${afterAI.timeComplexity}`,
  };
}