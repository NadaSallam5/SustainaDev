// report.ts
import { AIComplexityResult, OptimizationReport } from "./types";
import { resolveComplexity } from "./complexityValidator";

export function buildOptimizationReport(
  beforeAI: AIComplexityResult,
  afterAI: AIComplexityResult,
  beforeFacts?: any,
  afterFacts?: any,
  smellType?: string
): OptimizationReport {

  const result = resolveComplexity(beforeAI, afterAI, beforeFacts, afterFacts, smellType);


  return {
    metric: result.metric,
    before: result.before,
    after: result.after,
    improvement: `From ${result.before} → ${result.after}`,
    source: result.source, // ✅ NEW
  };
}