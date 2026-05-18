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
  if (s.includes("n^2") || s.includes("n²") || s.includes("n2")) return "O(n^2)";
  if (s.includes("n^3") || s.includes("n³")) return "O(n^3)";
  if (s.includes("2^n")) return "O(2^n)";
  if (s.includes("nlogn") || s.includes("nlog")) return "O(n log n)";
  if (s.includes("n*m") || s.includes("n×m") || s.includes("nm")) return "O(n^2)";
  if (s.includes("n")) return "O(n)";
  return expr;
}

// ─── Sanity check: catch obvious Qwen mistakes ───────────────────────────────
function sanitizeWithFacts(
  time: string,
  space: string,
  facts: any
): { time: string; space: string; corrected: boolean } {
  let corrected = false;

  // ✅ Debug logs
  console.log("🔬 sanitizeWithFacts INPUT time:", time);
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

  // ✅ Step 2: Extract dominant term from complex expressions like O(n^2 + n*m)
  const dominantTime = extractDominantTerm(time);
  const dominantSpace = extractDominantTerm(space);
  if (dominantTime !== time) { time = dominantTime; corrected = true; }
  if (dominantSpace !== space) { space = dominantSpace; corrected = true; }

  // ─── TIME: Correct downward (Qwen overestimates) ─────────────────────────

  // ✅ HashMap exists + no nested loops → O(n) — MUST be first
  if (time === "O(n^2)" && facts.hasHashMapLookup && !facts.hasNestedLoop) {
    console.log("✅ Correcting O(n^2) → O(n) because HashMap + no nested loop");
    time = "O(n)";
    corrected = true;
  }

  // Qwen said O(1) but there are loops → physically impossible
  if (time === "O(1)" && (facts.maxLoopDepth ?? 0) >= 1) {
    time = facts.hasNestedLoop ? "O(n^2)" : "O(n)";
    corrected = true;
  }

  // Qwen said O(1) but there is recursion → physically impossible
  if (time === "O(1)" && facts.callsSelf) {
    time = "O(n)";
    corrected = true;
  }

  // Qwen said O(n^3) but loopDepth is only 2 → physically impossible
  if (time === "O(n^3)" && (facts.maxLoopDepth ?? 0) <= 2 && !facts.callsSelf) {
    time = "O(n^2)";
    corrected = true;
  }

  // Qwen said O(2^n) but no recursion and no nested loops → impossible
  if (time === "O(2^n)" && !facts.callsSelf && (facts.maxLoopDepth ?? 0) < 2) {
    time = "O(n)";
    corrected = true;
  }

  // ✅ StringBuilder detected → O(n)
  if (time === "O(n^2)" && facts.usesStringBuilder && !facts.hasNestedLoop) {
    time = "O(n)";
    corrected = true;
  }

  // ✅ No nested loops, no string concat, no StringBuilder → O(n)
  if (
    time === "O(n^2)" &&
    !facts.hasNestedLoop &&
    !facts.hasStringConcatInLoop &&
    !facts.usesStringBuilder
  ) {
    time = "O(n)";
    corrected = true;
  }

  // ─── TIME: Correct upward (Qwen underestimates) ──────────────────────────

  // ✅ String concat in loop with no StringBuilder → O(n^2)
 if (
  time === "O(n)" &&
  facts.hasStringConcatInLoop &&
  !facts.usesStringBuilder &&
  !facts.hasHashMapLookup  // ✅ NEW
) {
  time = "O(n^2)";
  corrected = true;
}

  // ✅ Truly nested loops with no HashMap → O(n^2)
  if (
    time === "O(n)" &&
    facts.hasNestedLoop &&
    !facts.hasHashMapLookup &&
    (facts.maxLoopDepth ?? 0) >= 2
  ) {
    time = "O(n^2)";
    corrected = true;
  }

  // ─── SPACE ────────────────────────────────────────────────────────────────

  if (space === "O(1)" && facts.hasHashMapLookup) {
    space = "O(n)";
    corrected = true;
  }

  if (space === "O(1)" && facts.callsSelf) {
    space = "O(n)";
    corrected = true;
  }

  if (space === "O(1)" && facts.usesStringBuilder) {
    space = "O(n)";
    corrected = true;
  }

  console.log("🔬 sanitizeWithFacts OUTPUT time:", time);
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
      options: {
        temperature: 0.1,
        top_p: 0.9,
      },
    }),
  });

  const data: any = await response.json();
  console.log("🤖 Qwen raw response:", data.response);

  const jsonMatch = data.response?.match(/\{[\s\S]*"timeComplexity"[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON returned from Qwen");

  const cleaned = jsonMatch[0]
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\t/g, " ")
    .replace(/```json/g, "")
    .replace(/```/g, "");

  return JSON.parse(cleaned);
}

// ─── Main function ────────────────────────────────────────────────────────────
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
- NEVER return O(n + m), O(n + m + k), or any multi-variable form — always simplify to O(n)
- NEVER return complex expressions like O(n^2 + n*m) — always return ONLY the dominant term
- If complexity has multiple terms, return only the largest: O(n^2 + n) = O(n^2)
- O(n * m) where n and m are different lists = O(n^2) for reporting
- String += inside a loop = O(n^2) because each concatenation copies the entire accumulated string
- StringBuilder.append() inside a loop = O(n) because appending is amortized O(1)
- StringBuffer.append() inside a loop = O(n) same as StringBuilder
- StringBuilder or StringBuffer usage = O(n) space
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