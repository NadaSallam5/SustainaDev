import { MethodFacts } from "../types";
import { estimateBigO } from "./estimator";
import { OptimizationReport } from "./types";

export function buildOptimizationReport(
  beforeFacts: MethodFacts,
  afterFacts: MethodFacts
): OptimizationReport {
  const beforeBigO = estimateBigO(beforeFacts);
  const afterBigO = estimateBigO(afterFacts);

  return {
    before: beforeBigO,
    after: afterBigO,
    improvement: `From ${beforeBigO} → ${afterBigO}`
  };
}
