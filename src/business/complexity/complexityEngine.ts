import { BigONotation } from "./types";

/**
 * Deterministic Complexity Engine
 * Computes Big-O strictly from extracted structural facts.
 */
export function computeComplexityFromFacts(facts: any): BigONotation {
  // 🔁 Recursive + overlapping subproblems → exponential
  if (facts.callsSelf && facts.hasOverlappingSubproblems) {
    return "O(2^n)";
  }

  // 🔁 Linear recursion → O(n)
  if (facts.callsSelf && facts.isLinearRecursion) {
    return "O(n)";
  }

  // 🔁 Sort inside a loop → O(n^2 log n)
  if (facts.sortInsideLoop) {
    return "O(n^2 log n)";
  }

  // ✅ StringBuilder in loop → O(n), must come BEFORE string concat check
  // because after optimization both flags may be true (String var still declared)
  if (facts.usesStringBuilder) {
    return "O(n)";
  }

  // 🔁 String concat in loop → O(n^2)
  if (facts.hasStringConcatInLoop) {
    return "O(n^2)";
  }

  // 🔁 Loop depth >= 2: check if truly nested or just sequential
  if ((facts.maxLoopDepth ?? 0) >= 2) {
    // ✅ Sequential loops after HashMap optimization → O(n)
    if (facts.hasHashMapLookup && !facts.hasNestedLoop) {
      return "O(n)";
    }
    // Truly nested loops → quadratic
    return "O(n^2)";
  }

  // 🔁 Sorting call outside loop → O(n log n)
  if (facts.hasSortingCall) {
    return "O(n log n)";
  }

  // 🔁 Single loop → linear
  if ((facts.maxLoopDepth ?? 0) === 1) {
    return "O(n)";
  }

  // ⚪ No loops → constant
  return "O(1)";
}

export function computeSpaceFromFacts(facts: any): BigONotation {
  // Recursive calls use call stack → O(n) space
  if (facts.callsSelf && facts.isLinearRecursion) {
    return "O(n)";
  }

  // Exponential recursion → O(n) stack depth
  if (facts.callsSelf && facts.hasOverlappingSubproblems) {
    return "O(n)";
  }

  // HashMap/HashSet allocated → O(n) space
  if (facts.hasHashMapLookup) {
    return "O(n)";
  }

  // ✅ StringBuilder builds an internal char buffer → O(n) space
  // must come BEFORE string concat check for same reason as time complexity
  if (facts.usesStringBuilder) {
    return "O(n)";
  }

  // String concat in loop builds a new string each time → O(n)
  if (facts.hasStringConcatInLoop) {
    return "O(n)";
  }

  // No dynamic allocation detected → constant
  return "O(1)";
}