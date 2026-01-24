import { MethodFacts } from "../types";
import { estimateBigO, estimateSpaceBigO } from "./estimator";
import { OptimizationReport } from "./types";

export function buildOptimizationReport(
  beforeFacts: MethodFacts,
  afterFacts: MethodFacts
): OptimizationReport {
  const beforeTime = estimateBigO(beforeFacts);
  const afterTime = estimateBigO(afterFacts);

  const beforeSpace = estimateSpaceBigO(beforeFacts);
  const afterSpace = estimateSpaceBigO(afterFacts);

  const isFactorialCase =
    beforeFacts.callsSelf &&
    beforeFacts.isLinearRecursion &&
    !beforeFacts.hasOverlappingSubproblems && // not Fibonacci
    !afterFacts.callsSelf;                    // optimized becomes non-recursive

  if (isFactorialCase) {
    return {
      metric: "space",
      before: beforeSpace,
      after: afterSpace,
      improvement: `From ${beforeSpace} → ${afterSpace}`,
    };
  }

  return {
    metric: "time",
    before: beforeTime,
    after: afterTime,
    improvement: `From ${beforeTime} → ${afterTime}`,
  };
}
