import { UniversalFeatures } from "../types/universalFeatures"

export function extractFeatures(root: any, methodName?: string): UniversalFeatures {

  const features: UniversalFeatures = {
    loops: 0,
    loopDepth: 0,
    recursion: false,
    stringConcatInLoop: false,
    sortingCalls: 0,
    sortingInsideLoop: false,
    methodLength: 0
  }

  let depth = 0

  function walk(node: any) {
    features.methodLength++

    const isLoop =
      node.type === "for_statement" ||
      node.type === "enhanced_for_statement" ||  // Java foreach
      node.type === "while_statement" ||
      node.type === "do_statement" ||
      node.type === "for_in_statement" ||         // ✅ Python
      node.type === "for_of_statement"            // ✅ JavaScript

    if (isLoop) {
      features.loops++
      depth++
      features.loopDepth = Math.max(features.loopDepth, depth)
    }

    // sorting + recursion detection
    if (
      node.type === "method_invocation" ||  // Java
      node.type === "call_expression" ||    // JS / C++
      node.type === "call"                  // ✅ Python
    ) {
      const text = node.text

      if (text.includes("sort")) {
        features.sortingCalls++
        if (depth > 0) {
          features.sortingInsideLoop = true
        }
      }

      // recursion detection
      if (methodName && text.startsWith(methodName + "(")) {
        features.recursion = true
      }
    }

    // string concat INSIDE loop only
    if (
      node.type === "binary_expression" &&
      node.text.includes("+") &&
      depth > 0 &&
      (node.text.includes('"') || /\bString\b/.test(node.text))
    ) {
      features.stringConcatInLoop = true
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child)
      }
    }

    if (isLoop) {
      depth--
    }
  }

  walk(root)
  return features
}