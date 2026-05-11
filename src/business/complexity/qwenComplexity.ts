import { AIComplexityResult } from "./types";

export async function estimateComplexityWithQwen(
  code: string,
  facts: any
): Promise<AIComplexityResult> {
 const prompt = `
Analyze the following Java method and determine its Big-O time and space complexity.

Important rules:
1. Use standard Big-O notation only.
2. A single loop over n elements has time complexity O(n).
3. Nested loops over the SAME input → O(n^2).
4. Nested loops over DIFFERENT inputs → O(n*m).
5. HashSet/HashMap contains() → average O(1).
6. Preprocessing one collection then scanning another → O(n + m).

--- Strings ---
7. Java Strings are immutable.
8. String concatenation inside a loop (s = s + value) → O(n^2).
9. StringBuilder with append() inside loop → O(n).

--- Sorting ---
10. Sorting once → O(n log n).
11. Sorting inside a loop → O(n^2 log n).
12. Never drop the log n factor in sorting-inside-loop cases.

--- Recursion ---
13. Single recursion that calls itself once per step, such as factorial recursion, has:
    - Time complexity O(n)
    - Space complexity O(n) because of the call stack
14. Fibonacci-style recursion with overlapping subproblems has time complexity O(2^n).
15. Converting single recursion to iteration usually keeps time complexity O(n) but reduces space complexity from O(n) to O(1).

Java Code:
${code}

Extracted Facts:
${JSON.stringify(facts, null, 2)}

Return ONLY valid JSON in this exact format:
{
  "timeComplexity": "",
  "spaceComplexity": "",
  "explanation": ""
}
`;

  const response = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen2.5-coder:7b",
      prompt,
      stream: false,
    }),
  });

  const data: any = await response.json();
  console.log("Qwen complexity raw response:", data.response);

  const jsonMatch = data.response?.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No valid JSON returned from Qwen");
  }

 let cleaned = jsonMatch[0]
  .replace(/\n/g, " ")
  .replace(/\r/g, " ")
  .replace(/\t/g, " ")
  .replace(/```json/g, "")
  .replace(/```/g, "");

const parsed = JSON.parse(cleaned);

  return {
    timeComplexity: String(parsed.timeComplexity ?? "Unknown"),
    spaceComplexity: String(parsed.spaceComplexity ?? "Unknown"),
    explanation: String(parsed.explanation ?? "No explanation returned"),
  };
}