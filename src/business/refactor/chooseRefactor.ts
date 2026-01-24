import { MethodFacts } from "../types";

export function chooseRefactor(facts: MethodFacts) {
  if (facts.callsSelf) {
    return { type: "RECURSION", reason: "Recursive method detected" };
  }

  if (facts.maxLoopDepth >= 2) {
    return { type: "NESTED_LOOPS", reason: "Nested loops detected" };
  }

  return { type: "GENERAL", reason: "General optimization" };
}
