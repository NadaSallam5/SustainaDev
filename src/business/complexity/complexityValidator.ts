import { BigONotation, AIComplexityResult } from "./types";

// ─── Layer 1: Normalize AI output to valid BigONotation ──────────────────────
export function normalizeBigO(raw: string): BigONotation {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");

  if (s.includes("n^3") || s.includes("n³")) return "O(n^3)";
  if (s.includes("2^n")) return "O(2^n)";
  if (s.includes("n^2logn") || s.includes("n^2log(n)") || s.includes("n²logn")) return "O(n^2 log n)";
  if (s.includes("n^2")) return "O(n^2)";
  if (s.includes("n*m") || s.includes("nm") || s.includes("n×m")) return "O(n^2)";
  if (s.includes("nlogn") || s.includes("nlog")) return "O(n log n)";

  if (s === "o(n+m+k)") return "O(n)";
  if (/^o\(([a-z]\+)*[a-z]\)$/.test(s)) return "O(n)";
  if (s === "o(n+m)" || s === "o(m+n)") return "O(n)";

  if (s === "o(1)" || s === "constant") return "O(1)";
  if (s === "o(logn)" || s === "o(log(n))") return "O(log n)";
  if (s === "o(n)" || s === "linear") return "O(n)";
  if (s === "o(n,m)") return "O(n*m)";
  if (s === "o(2n)" || s === "exponential") return "O(2^n)";

  if (
    !s.includes("^2") &&
    !s.includes("^3") &&
    !s.includes("2^") &&
    !s.includes("n!") &&
    s.startsWith("o(") &&
    s.includes("n")
  ) {
    return "O(n)";
  }

  return "Unknown";
}

// ─── Layer 2: Validate AI result against structural facts ────────────────────
export function validateAgainstFacts(
  time: BigONotation,
  facts: any
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (!facts?.sortInsideLoop && !facts?.hasSortingCall) {
    if (time === "O(n log n)" || time === "O(n^2 log n)") {
      warnings.push(`Reported ${time} but no sorting detected in facts.`);
    }
  }

  if (!facts?.callsSelf && (facts?.maxLoopDepth ?? 0) <= 1) {
    if (time === "O(2^n)" || time === "O(n^3)") {
      warnings.push(`Reported ${time} but no recursion and loopDepth <= 1.`);
    }
  }

  if ((facts?.maxLoopDepth ?? 0) <= 1 && !facts?.callsSelf) {
    if (time === "O(n^3)") {
      warnings.push(`Reported O(n^3) but maxLoopDepth is ${facts?.maxLoopDepth ?? 0}.`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

// ─── Layer 3: Check explanation consistency with facts ───────────────────────
export function explanationMatchesFacts(explanation: string, facts: any): string[] {
  const warnings: string[] = [];
  const e = (explanation ?? "").toLowerCase();

  if (e.includes("sort") && !facts?.hasSortingCall && !facts?.sortInsideLoop) {
    warnings.push("Explanation mentions sorting but no sorting detected in facts.");
  }
  if ((e.includes("recursion") || e.includes("recursive")) && !facts?.callsSelf) {
    warnings.push("Explanation mentions recursion but callsSelf is false.");
  }
  if (e.includes("nested loop") && (facts?.maxLoopDepth ?? 0) < 2) {
    warnings.push("Explanation mentions nested loops but loopDepth < 2.");
  }

  return warnings;
}

// ─── Layer 4: Known smell overrides (deterministic cases) ────────────────────
export function inferKnownSmellComplexity(
  beforeFacts: any,
  afterFacts: any,
  smellType?: string
): { metric: "time" | "space"; before: BigONotation; after: BigONotation } | null {

  if (smellType === "STRING_BUILDER") {
    return { metric: "time", before: "O(n^2)", after: "O(n)" };
  }

  if (smellType === "SORTING_IN_LOOP") {
    return { metric: "time", before: "O(n^2 log n)", after: "O(n log n)" };
  }

  if (smellType === "NESTED_LOOPS") {
    return {
      metric: "time",
      before: heuristicTimeFromFacts(beforeFacts),
      after: "O(n)",
    };
  }

  if (smellType === "SORTING") {
    return { metric: "time", before: "O(n log n)", after: "O(n)" };
  }

  if (
    smellType === "ITERATIVE_REWRITE" &&
    beforeFacts?.callsSelf === true &&
    beforeFacts?.isLinearRecursion === true &&
    !beforeFacts?.hasOverlappingSubproblems &&
    afterFacts?.callsSelf === false
  ) {
    return { metric: "space", before: "O(n)", after: "O(1)" };
  }

  return null;
}

// ─── Layer 5: Heuristic fallback from facts ───────────────────────────────────
export function heuristicTimeFromFacts(facts: any): BigONotation {
  if (facts?.callsSelf && facts?.hasOverlappingSubproblems) return "O(2^n)";
  if (facts?.callsSelf && facts?.isLinearRecursion) return "O(n)";
  if (facts?.sortInsideLoop) return "O(n^2 log n)";
  if (facts?.hasSortingCall) return "O(n log n)";
  if (facts?.hasStringConcatInLoop) return "O(n^2)";
  if ((facts?.maxLoopDepth ?? 0) >= 3) return "O(n^3)";
  if ((facts?.maxLoopDepth ?? 0) === 2) {
    if (facts?.hasHashMapLookup && !facts?.hasNestedLoop) return "O(n)";
    return "O(n^2)";
  }
  if ((facts?.maxLoopDepth ?? 0) === 1) return "O(n)";
  return "O(1)";
}

// ─── Verify Qwen's answer makes sense for the smell type ─────────────────────
function qwenAnswerIsPlausible(
  beforeTime: BigONotation,
  afterTime: BigONotation,
  smellType?: string
): boolean {
  // Must always be different
  if (beforeTime === afterTime) return false;

  // For each smell, the BEFORE must be at least as complex as AFTER
  const order: BigONotation[] = [
    "O(1)", "O(log n)", "O(n)", "O(n log n)",
    "O(n^2)", "O(n^2 log n)", "O(n^3)", "O(2^n)"
  ];
  const beforeRank = order.indexOf(beforeTime);
  const afterRank = order.indexOf(afterTime);

  // BEFORE should be worse (higher rank) than AFTER
  if (beforeRank !== -1 && afterRank !== -1 && beforeRank <= afterRank) return false;

  // Smell-specific sanity checks
  if (smellType === "STRING_BUILDER") {
    // BEFORE must be at least O(n^2), AFTER must be O(n)
    if (beforeRank < order.indexOf("O(n^2)")) return false;
    if (afterTime !== "O(n)") return false;
  }

  if (smellType === "SORTING_IN_LOOP") {
    if (beforeTime !== "O(n^2 log n)") return false;
    if (afterTime !== "O(n log n)" && afterTime !== "O(n)") return false;
  }

  if (smellType === "NESTED_LOOPS") {
    if (beforeRank < order.indexOf("O(n^2)")) return false;
    if (afterRank > order.indexOf("O(n)")) return false;
  }

  if (smellType === "ITERATIVE_REWRITE") {
    // Time complexity stays O(n), only space changes — handled separately
    // So time before/after being equal is actually OK here
    return true;
  }

  return true;
}

// ─── Main resolver ────────────────────────────────────────────────────────────
export function resolveComplexity(
  beforeAI: AIComplexityResult,
  afterAI: AIComplexityResult,
  beforeFacts: any,
  afterFacts: any,
  smellType?: string
): {
  metric: "time" | "space";
  before: BigONotation;
  after: BigONotation;
  source: "ai" | "rules" | "hybrid-fallback";
  warnings: string[];
} {
  const warnings: string[] = [];

  // ─── Special case: ITERATIVE_REWRITE reports SPACE not TIME ──────────────
  if (smellType === "ITERATIVE_REWRITE") {
    const known = inferKnownSmellComplexity(beforeFacts, afterFacts, smellType);
    if (known) {
      console.log("✅ ITERATIVE_REWRITE: using space complexity rules");
      return { ...known, source: "rules", warnings };
    }
  }

  // ─── Normalize Qwen's output ──────────────────────────────────────────────
  const beforeTime = normalizeBigO(beforeAI.timeComplexity);
  const afterTime = normalizeBigO(afterAI.timeComplexity);

  console.log(`🤖 Qwen → before: ${beforeTime}, after: ${afterTime}`);

  // ─── Check if Qwen returned valid and plausible values ───────────────────
  if (
    beforeTime !== "Unknown" &&
    afterTime !== "Unknown" &&
    qwenAnswerIsPlausible(beforeTime, afterTime, smellType)
  ) {
    console.log("✅ Qwen answer accepted and plausible");
    return {
      metric: "time",
      before: beforeTime,
      after: afterTime,
      source: "ai",
      warnings,
    };
  }

  // ─── Qwen failed or gave implausible answer → fall back to rules ─────────
  if (beforeTime === "Unknown" || afterTime === "Unknown") {
    console.warn("⚠️ Qwen returned Unknown, falling back to rules...");
    warnings.push("Qwen returned Unknown. Using rules as fallback.");
  } else {
    console.warn(`⚠️ Qwen answer implausible (before=${beforeTime}, after=${afterTime}) for ${smellType}, falling back to rules...`);
    warnings.push(`Qwen answer implausible for ${smellType}. Using rules as fallback.`);
  }

  const known = inferKnownSmellComplexity(beforeFacts, afterFacts, smellType);
  if (known) {
    return { ...known, source: "rules", warnings };
  }

  return {
    metric: "time",
    before: heuristicTimeFromFacts(beforeFacts),
    after: heuristicTimeFromFacts(afterFacts),
    source: "hybrid-fallback",
    warnings,
  };
}