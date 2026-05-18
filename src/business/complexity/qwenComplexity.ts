import { AIComplexityResult } from "./types";

// ─── Helper: normalize multi-variable linear expressions → O(n) ──────────────
function normalizeMultiVar(expr: string): string {
  const s = expr.trim().toLowerCase().replace(/\s+/g, "");
  if (/^o\(([a-z]\+)*[a-z]\)$/.test(s)) return "O(n)";
  return expr;
}

// ─── Helper: extract dominant Big-O term from complex expressions ─────────────
function extractDominantTerm(expr: string): string {
  const s = expr.trim().toLowerCase().replace(/\s+/g, "");
  if (s.includes("n^2logn") || s.includes("n^2log(n)") || s.includes("n²logn")) return "O(n^2 log n)";
  if (s.includes("n^2") || s.includes("n²") || s.includes("n2")) return "O(n^2)";
  if (s.includes("n^3") || s.includes("n³")) return "O(n^3)";
  if (s.includes("2^n")) return "O(2^n)";
  if (s.includes("nlogn") || s.includes("nlog")) return "O(n log n)";
  if (s.includes("n*m") || s.includes("n×m") || s.includes("nm")) return "O(n^2)";
  if (s.includes("n")) return "O(n)";
  return expr;
}

// ─── Sanity check: catch physically impossible Qwen answers ──────────────────
// role="before"|"after" and smellType prevent overcorrection
function sanitizeWithFacts(
  time: string,
  space: string,
  facts: any,
  role: "before" | "after" = "after",
  smellType?: string
): { time: string; space: string; corrected: boolean } {
  let corrected = false;

  console.log(`🔬 sanitizeWithFacts [${role}/${smellType}] INPUT time:`, time);
  console.log("🔬 facts.hasHashMapLookup:", facts.hasHashMapLookup);
  console.log("🔬 facts.hasNestedLoop:", facts.hasNestedLoop);
  console.log("🔬 facts.maxLoopDepth:", facts.maxLoopDepth);
  console.log("🔬 facts.hasStringConcatInLoop:", facts.hasStringConcatInLoop);
  console.log("🔬 facts.usesStringBuilder:", facts.usesStringBuilder);

  // ✅ Step 1: Normalize multi-variable linear expressions
  const normalizedTime = normalizeMultiVar(time);
  const normalizedSpace = normalizeMultiVar(space);
  if (normalizedTime !== time) { time = normalizedTime; corrected = true; }
  if (normalizedSpace !== space) { space = normalizedSpace; corrected = true; }

  // ✅ Step 2: Extract dominant term
  const dominantTime = extractDominantTerm(time);
  const dominantSpace = extractDominantTerm(space);
  if (dominantTime !== time) { time = dominantTime; corrected = true; }
  if (dominantSpace !== space) { space = dominantSpace; corrected = true; }

  // ─── Physically impossible corrections only ───────────────────────────────

  // O(1) but there are loops → impossible
  if (time === "O(1)" && (facts.maxLoopDepth ?? 0) >= 1) {
    time = facts.hasNestedLoop ? "O(n^2)" : "O(n)";
    corrected = true;
  }

  // O(1) but there is recursion → impossible
  if (time === "O(1)" && facts.callsSelf) {
    time = "O(n)";
    corrected = true;
  }

  // O(n^3) but loopDepth is only 2 → impossible
  if (time === "O(n^3)" && (facts.maxLoopDepth ?? 0) <= 2 && !facts.callsSelf) {
    time = "O(n^2)";
    corrected = true;
  }

  // O(2^n) but no recursion and no nested loops → impossible
  if (time === "O(2^n)" && !facts.callsSelf && (facts.maxLoopDepth ?? 0) < 2) {
    time = "O(n)";
    corrected = true;
  }

  // ─── STRING_BUILDER specific corrections ──────────────────────────────────
  if (smellType === "STRING_BUILDER") {
    if (role === "before" && time === "O(n)" && facts.hasStringConcatInLoop && !facts.usesStringBuilder) {
      time = "O(n^2)";
      corrected = true;
    }
    if (role === "after" && time === "O(n^2)" && facts.usesStringBuilder) {
      time = "O(n)";
      corrected = true;
    }
  }

  // ─── NESTED_LOOPS specific corrections ────────────────────────────────────
  if (smellType === "NESTED_LOOPS") {
    if (role === "before" && time === "O(n)" && (facts.maxLoopDepth ?? 0) >= 2 && !facts.hasHashMapLookup) {
      time = "O(n^2)";
      corrected = true;
    }
    if (role === "after" && time === "O(n^2)" && facts.hasHashMapLookup && !facts.hasNestedLoop) {
      time = "O(n)";
      corrected = true;
    }
  }

  // ─── SORTING_IN_LOOP specific corrections ─────────────────────────────────
  if (smellType === "SORTING_IN_LOOP") {
    if (role === "before" && time === "O(n)" && facts.sortInsideLoop) {
      time = "O(n^2 log n)";
      corrected = true;
    }
    if (role === "after" && time === "O(n^2 log n)" && !facts.sortInsideLoop) {
      time = "O(n log n)";
      corrected = true;
    }
  }

  // ─── SPACE corrections ────────────────────────────────────────────────────
  if (space === "O(1)" && facts.hasHashMapLookup) { space = "O(n)"; corrected = true; }
  if (space === "O(1)" && facts.callsSelf) { space = "O(n)"; corrected = true; }
  if (space === "O(1)" && facts.usesStringBuilder) { space = "O(n)"; corrected = true; }

  console.log(`🔬 sanitizeWithFacts [${role}] OUTPUT time:`, time);
  return { time, space, corrected };
}

// ─── Call Qwen with retry logic ───────────────────────────────────────────────
async function callQwen(prompt: string): Promise<any> {
  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5-coder:7b",
      prompt,
      stream: false,
      options: { temperature: 0.1, top_p: 0.9 },
    }),
  });

  const data: any = await response.json();
  console.log("🤖 Qwen raw response:", data.response);

  const jsonMatch = data.response?.match(/\{[\s\S]*"timeComplexity"[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON returned from Qwen");

  const cleaned = jsonMatch[0]
    .replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ")
    .replace(/```json/g, "").replace(/```/g, "");

  return JSON.parse(cleaned);
}

// ─── Pair estimation — analyze BEFORE and AFTER in a single Qwen call ────────
export async function estimateComplexityPairWithQwen(
  beforeCode: string,
  afterCode: string,
  beforeFacts: any,
  afterFacts: any,
  smellType?: string
): Promise<{ before: AIComplexityResult; after: AIComplexityResult }> {

  const smellHints: Record<string, string> = {
    STRING_BUILDER:
      "The optimization replaced String += concatenation inside a loop with StringBuilder.append().\n" +
      "BEFORE: String += in loop = O(n^2) time because each concatenation copies the whole string.\n" +
      "AFTER: StringBuilder.append() in loop = O(n) time because appending is amortized O(1).",
    NESTED_LOOPS:
      "The optimization replaced nested loops with HashMap lookups.\n" +
      "BEFORE: Nested loops = O(n^2) time.\n" +
      "AFTER: Sequential loops with O(1) HashMap lookups = O(n) time.",
    SORTING_IN_LOOP:
      "The optimization moved sorting outside the loop.\n" +
      "BEFORE: Sort inside loop = O(n^2 log n) time.\n" +
      "AFTER: Sort once outside loop = O(n log n) time.",
    SORTING:
      "The optimization replaced sorting with a linear scan.\n" +
      "BEFORE: Sort = O(n log n) time.\n" +
      "AFTER: Linear scan = O(n) time.",
    ITERATIVE_REWRITE:
      "The optimization converted recursion to an iterative loop.\n" +
      "BEFORE: Linear recursion = O(n) time, O(n) space (call stack).\n" +
      "AFTER: Iterative = O(n) time, O(1) space.",
  };

  const smellContext = smellType && smellHints[smellType]
    ? `\nOptimization context:\n${smellHints[smellType]}\n`
    : "";

  const prompt = `
You are an expert algorithm analyst specialized in Big-O complexity analysis.

You will analyze TWO versions of the same method — BEFORE and AFTER an optimization.
Your job is to identify the Big-O complexity of EACH version separately.
${smellContext}
IMPORTANT: The two versions MUST have different complexities. If you think they are the same, look more carefully at the optimization that was applied.

=== BEFORE (original, unoptimized) ===
\`\`\`
${beforeCode}
\`\`\`

=== AFTER (optimized) ===
\`\`\`
${afterCode}
\`\`\`

Think step by step for EACH version:
1. Find all loops — are they NESTED inside each other, or SEQUENTIAL (one after another)?
2. Find any recursion
3. Find any sorting calls (.sort(), Collections.sort())
4. Find any HashMap or HashSet usage
5. Look for string concatenation patterns (+=, string + string)
6. Check if StringBuilder or StringBuffer is used
7. Calculate Time and Space complexity for EACH version

Critical rules:
- Nested loops = O(n^2), sequential loops = O(n)
- Single loop = O(n), no loops/recursion = O(1)
- Loop with sort inside = O(n^2 log n)
- HashMap/HashSet lookup inside loop = O(n)
- Linear recursion = O(n) time, O(n) space
- Iterative version = O(n) time, O(1) space
- HashMap allocated = O(n) space
- String += in loop = O(n^2)
- StringBuilder.append() in loop = O(n)
- NEVER return the same timeComplexity for BEFORE and AFTER
- NEVER return Unknown — always pick ONE exact value
- NEVER return multi-variable forms like O(n+m) — use O(n)
- Return only the dominant term: O(n^2 + n) = O(n^2)

Return ONLY this JSON, no extra text, no markdown:
{
  "before": {
    "timeComplexity": "O(...)",
    "spaceComplexity": "O(...)",
    "explanation": "brief explanation of the BEFORE version"
  },
  "after": {
    "timeComplexity": "O(...)",
    "spaceComplexity": "O(...)",
    "explanation": "brief explanation of the AFTER version and what improved"
  }
}
`;

  const maxAttempts = 3;
  let attempts = 0;
  let parsed: any;

  while (attempts < maxAttempts) {
    try {
      attempts++;

      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen2.5-coder:7b",
          prompt,
          stream: false,
          options: { temperature: 0.1, top_p: 0.9 },
        }),
      });

      const data: any = await response.json();
      console.log("🤖 Qwen pair raw response:", data.response);

      const jsonMatch = data.response?.match(/\{[\s\S]*"before"[\s\S]*"after"[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No valid pair JSON returned from Qwen");

      const cleaned = jsonMatch[0]
        .replace(/\n/g, " ").replace(/\r/g, " ").replace(/\t/g, " ")
        .replace(/```json/g, "").replace(/```/g, "");

      parsed = JSON.parse(cleaned);
      console.log("✅ Qwen pair parsed JSON:", JSON.stringify(parsed));
      break;

    } catch (e) {
      console.warn(`⚠️ Qwen pair attempt ${attempts} failed:`, e);
      if (attempts >= maxAttempts) {
        throw new Error(`Qwen pair estimation failed after ${maxAttempts} attempts`);
      }
    }
  }

  const beforeSanitized = sanitizeWithFacts(
    parsed.before.timeComplexity ?? "",
    parsed.before.spaceComplexity ?? "",
    beforeFacts,
    "before",
    smellType
  );

  const afterSanitized = sanitizeWithFacts(
    parsed.after.timeComplexity ?? "",
    parsed.after.spaceComplexity ?? "",
    afterFacts,
    "after",
    smellType
  );

  if (beforeSanitized.corrected) {
    console.warn(`⚠️ Qwen BEFORE corrected: time=${parsed.before.timeComplexity}→${beforeSanitized.time}`);
  }
  if (afterSanitized.corrected) {
    console.warn(`⚠️ Qwen AFTER corrected: time=${parsed.after.timeComplexity}→${afterSanitized.time}`);
  }

  return {
    before: {
      timeComplexity: beforeSanitized.time,
      spaceComplexity: beforeSanitized.space,
      explanation: parsed.before.explanation ?? "No explanation returned",
    },
    after: {
      timeComplexity: afterSanitized.time,
      spaceComplexity: afterSanitized.space,
      explanation: parsed.after.explanation ?? "No explanation returned",
    },
  };
}

// ─── Original single-method estimator (kept as fallback) ─────────────────────
export async function estimateComplexityWithQwen(
  code: string,
  facts: any,
  methodName?: string
): Promise<AIComplexityResult> {

  const prompt = `
You are an expert algorithm analyst specialized in Big-O complexity analysis.

Analyze this code carefully:

\`\`\`
${code}
\`\`\`

Think step by step:
1. Find all loops — are they NESTED inside each other, or SEQUENTIAL (one after another)?
2. Find any recursion
3. Find any sorting calls (like .sort(), Collections.sort())
4. Find any HashMap or HashSet usage
5. Look for string concatenation patterns — critical for complexity
6. Check if StringBuilder or StringBuffer is used
7. Calculate Time and Space complexity

Critical rules you MUST follow:
- Two loops NESTED inside each other = O(n^2)
- Two loops SEQUENTIAL (not nested) = O(n)
- Single loop = O(n)
- No loops, no recursion = O(1)
- Loop with sort inside = O(n^2 log n)
- HashMap/HashSet lookup inside loop = O(n) because lookup is O(1)
- Recursion with overlapping subproblems = O(2^n)
- Linear recursion = O(n)
- HashMap allocated = O(n) space
- No extra data structures = O(1) space
- NEVER return "Unknown" or ranges — always pick ONE exact value
- Sequential loops = O(n), NOT O(n^2)
- NEVER return O(n + m) — simplify to O(n)
- String += inside a loop = O(n^2)
- StringBuilder.append() inside a loop = O(n)
- HashMap pre-built before main loop + O(1) lookups inside = O(n) overall

Return ONLY this JSON, no extra text, no markdown:
{
  "timeComplexity": "O(...)",
  "spaceComplexity": "O(...)",
  "explanation": "brief explanation of why"
}
`;

  let parsed: any;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      attempts++;
      parsed = await callQwen(prompt);
      console.log("✅ Qwen parsed JSON:", JSON.stringify(parsed));
      break;
    } catch (e) {
      console.warn(`⚠️ Qwen attempt ${attempts} failed:`, e);
      if (attempts >= maxAttempts) {
        console.error("❌ Qwen failed all attempts, using facts-based fallback");
        return {
          timeComplexity: facts.usesStringBuilder ? "O(n)" :
                          facts.hasNestedLoop ? "O(n^2)" :
                          facts.hasHashMapLookup ? "O(n)" :
                          facts.hasStringConcatInLoop ? "O(n^2)" :
                          (facts.maxLoopDepth ?? 0) >= 1 ? "O(n)" : "O(1)",
          spaceComplexity: facts.usesStringBuilder ? "O(n)" :
                           facts.hasHashMapLookup ? "O(n)" :
                           facts.callsSelf ? "O(n)" : "O(1)",
          explanation: "Fallback: Qwen unavailable, estimated from structural facts.",
        };
      }
    }
  }

  const rawTime = (parsed.timeComplexity ?? "").trim();
  const rawSpace = (parsed.spaceComplexity ?? "").trim();
  const explanation = parsed.explanation ?? "No explanation returned";

  const { time, space, corrected } = sanitizeWithFacts(rawTime, rawSpace, facts);

  if (corrected) {
    console.warn(`⚠️ Qwen answer corrected: time=${rawTime}→${time}, space=${rawSpace}→${space}`);
  } else {
    console.log(`✅ Qwen answer accepted: time=${time}, space=${space}`);
  }

  return {
    timeComplexity: time,
    spaceComplexity: space,
    explanation,
  };
}