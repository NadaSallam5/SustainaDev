import { AIComplexityResult } from "./types";

// ─── Sanity check: catch obvious Qwen mistakes ───────────────────────────────
function sanitizeWithFacts(
  time: string,
  space: string,
  facts: any
): { time: string; space: string; corrected: boolean } {
  let corrected = false;

  // ─── TIME: Only correct truly impossible answers ──────────────────────────

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

  // ✅ NEW: Qwen said O(n^2) but StringBuilder detected → string concat optimized
  if (time === "O(n^2)" && facts.hasStringBuilder && !facts.hasNestedLoop) {
    time = "O(n)";
    corrected = true;
  }

  // ✅ NEW: Qwen said O(n^2) but no nested loops and no string concat → wrong
  if (
    time === "O(n^2)" &&
    !facts.hasNestedLoop &&
    !facts.hasStringConcatInLoop &&
    !facts.hasStringBuilder === false
  ) {
    time = "O(n)";
    corrected = true;
  }

  // ✅ NEW: Qwen returned O(n + m + k) or any multi-variable linear expression
  // e.g. O(n + m), O(n + m + k), O(a + b + c + d) → collapse to O(n)
  // Qwen is technically correct but we normalize to a single variable for reporting


  // ─── SPACE: Only correct truly impossible answers ─────────────────────────

  // Qwen said O(1) space but HashMap exists → impossible, HashMap costs O(n)
  if (space === "O(1)" && facts.hasHashMapLookup) {
    space = "O(n)";
    corrected = true;
  }

  // Qwen said O(1) space but recursion exists → impossible, call stack costs O(n)
  if (space === "O(1)" && facts.callsSelf) {
    space = "O(n)";
    corrected = true;
  }

  // ✅ NEW: StringBuilder uses O(n) space
  if (space === "O(1)" && facts.hasStringBuilder) {
    space = "O(n)";
    corrected = true;
  }

  // ✅ NEW: Normalize multi-variable linear space expressions → O(n)
 

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

Analyze this code carefully. Focus ONLY on the method named "${methodName}". Ignore all other methods completely.

\`\`\`
${code}
\`\`\`

Think step by step about "${methodName}" ONLY:
1. Find all loops inside "${methodName}" — are they NESTED inside each other, or SEQUENTIAL?
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
- String += inside a loop = O(n^2) because each concatenation copies the entire accumulated string (strings are immutable)
- StringBuilder.append() inside a loop = O(n) because appending is amortized O(1) — even if there is a loop, it is NOT O(n^2)
- StringBuffer.append() inside a loop = O(n) same as StringBuilder
- StringBuilder or StringBuffer usage = O(n) space because it grows with input
- O(n + m + k) where all variables represent different list sizes = O(n) — always collapse multi-variable linear expressions into O(n)
- Sequential loops over different lists (one after another, not nested) = O(n) total, NOT O(n + m + k)
- HashMap pre-built before main loop + O(1) lookups inside main loop = O(n) overall, not O(n^2)

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
          timeComplexity: facts.hasStringBuilder ? "O(n)" :
                          facts.hasNestedLoop ? "O(n^2)" :
                          facts.hasHashMapLookup ? "O(n)" :
                          facts.hasStringConcatInLoop ? "O(n^2)" :
                          (facts.maxLoopDepth ?? 0) >= 1 ? "O(n)" : "O(1)",
          spaceComplexity: facts.hasStringBuilder ? "O(n)" :
                           facts.hasHashMapLookup ? "O(n)" :
                           facts.callsSelf ? "O(n)" : "O(1)",
          explanation: "Fallback: Qwen unavailable, estimated from structural facts.",
        };
      }
    }
  }

  // ─── Extract Qwen's answer ────────────────────────────────────────────────
  const rawTime = (parsed.timeComplexity ?? "").trim();
  const rawSpace = (parsed.spaceComplexity ?? "").trim();
  const explanation = parsed.explanation ?? "No explanation returned";

  // ─── Sanity check: only fix truly impossible answers ─────────────────────
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