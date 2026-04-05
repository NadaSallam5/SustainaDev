import { MethodFacts } from "../types";

export function chooseRefactor(facts: MethodFacts) {

  // 1) String concat
  if (facts.hasStringConcatInLoop === true) {
    return { type: "STRING_CONCAT", reason: "String concatenation inside loop detected (O(n^2))." };
  }

  // 2) Sorting inside loop (more specific first)
  if (facts.sortInsideLoop === true) {
    return { type: "SORTING_IN_LOOP", reason: "Sorting inside a loop causes O(n log n * n)." };
  }

  // 3) General sorting
  if (facts.hasSortingCall === true) {
    return { type: "SORTING", reason: "Sorting detected (may require optimization)." };
  }

  // 4) Nested loops
  if (facts.maxLoopDepth >= 2) {
    return { type: "NESTED_LOOPS", reason: "Nested loops detected." };
  }

  // 5) Recursion
  if (facts.callsSelf === true) {
    return { type: "RECURSION", reason: "Recursive method detected." };
  }

  return { type: "GENERAL", reason: "General optimization." };
}