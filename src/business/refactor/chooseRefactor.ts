import { FunctionMetrics } from "../types";

export function decideRefactorType(func: FunctionMetrics) {
  const methodName = func.name.trim();
  const { content = "" } = func;

  // 1. Find where the method name starts
  const nameIndex = content.indexOf(methodName);

  // 2. Find the first '{' AFTER the method name (this is the true body start)
  const bodyStart = content.indexOf("{", nameIndex);

  const methodBody =
    bodyStart !== -1 ? content.substring(bodyStart + 1) : content;

  const recursionRegex = new RegExp(`\\b${methodName}\\s*\\(`);
  const isRecursive = recursionRegex.test(methodBody);

  console.log(
    `🔍 Detector: Method [${methodName}] | Recursive: ${isRecursive}`,
  );

  if (isRecursive) {
    return { type: "RECURSION" };
  }

  // Improved Loop Detection using word boundaries
  const loopMatches = content.match(/\bfor\b|\bwhile\b/g);
  const loopCount = loopMatches ? loopMatches.length : 0;

  if (loopCount >= 2) {
    return { type: "NESTED_LOOPS" };
  }

  return { type: "GENERAL" };
}
