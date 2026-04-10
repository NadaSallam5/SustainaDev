import { UniversalFeatures } from "../types/universalFeatures"

export function extractFeatures(root: any, methodName?: string): UniversalFeatures {


  // ─── Tree-sitter path: Java / Python / JS ───────────────────────────────

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

  // Track variable names declared as String type
  const stringVars = new Set<string>()

  function collectStringVars(node: any) {
    if (node.type === "local_variable_declaration") {
      const typeNode = node.children?.find(
        (c: any) => c.type === "type_identifier" || c.type === "integral_type"
      )
      if (typeNode?.text === "String") {
        for (const child of node.children ?? []) {
          if (child.type === "variable_declarator") {
            const nameNode = child.children?.find((c: any) => c.type === "identifier")
            if (nameNode) stringVars.add(nameNode.text)
          }
        }
      }
    }

    if (node.type === "formal_parameter") {
      const typeNode = node.children?.find((c: any) => c.type === "type_identifier")
      if (typeNode?.text === "String") {
        const nameNode = node.children?.find((c: any) => c.type === "identifier")
        if (nameNode) stringVars.add(nameNode.text)
      }
    }

    for (const child of node.children ?? []) {
      collectStringVars(child)
    }
  }

  collectStringVars(root)

  function isStringConcatNode(node: any): boolean {
    const text: string = node.text ?? ""

    // Pattern 1: binary_expression with + containing a string literal
    if (
      node.type === "binary_expression" &&
      text.includes("+") &&
      (text.includes('"') || text.includes("'"))
    ) {
      return true
    }

    // Pattern 2: binary_expression with + where one operand is a known String var
    if (node.type === "binary_expression" && text.includes("+")) {
      const children = node.children ?? []
      const left = children[0]
      const right = children[2]
      if (
        (left && stringVars.has(left.text)) ||
        (right && stringVars.has(right.text))
      ) {
        return true
      }
    }

    // Pattern 3: assignment_expression  s = s + i  or  s += i
    if (node.type === "assignment_expression") {
      const children = node.children ?? []
      const left = children[0]
      const op = children[1]?.text
      const right = children[2]

      if (op === "+=" && left && stringVars.has(left.text)) {
        return true
      }

      if (op === "=" && left && stringVars.has(left.text) && right) {
        if (
          right.type === "binary_expression" &&
          right.text.includes("+") &&
          right.text.includes(left.text)
        ) {
          return true
        }
      }
    }

    return false
  }

  function walk(node: any) {
    features.methodLength++

    const isLoop =
      node.type === "for_statement" ||
      node.type === "enhanced_for_statement" ||
      node.type === "while_statement" ||
      node.type === "do_statement" ||
      node.type === "for_in_statement" ||
      node.type === "for_of_statement"

    if (isLoop) {
      features.loops++
      depth++
      features.loopDepth = Math.max(features.loopDepth, depth)
    }

    if (
      node.type === "method_invocation" ||
      node.type === "call_expression" ||
      node.type === "call"
    ) {
      const text = node.text

      if (text.includes("sort")) {
        features.sortingCalls++
        if (depth > 0) {
          features.sortingInsideLoop = true
        }
      }

      if (methodName && text.startsWith(methodName + "(")) {
        features.recursion = true
      }
    }

    // String concat INSIDE loop
    if (depth > 0 && isStringConcatNode(node)) {
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