import { OptimizationStrategy } from "./chooseOptimizationStrategy";

export function generateIterativeRewrite(
  methodName: string,
  strategy: OptimizationStrategy
) {

  // 🔁 Case 1: Recursion → Iterative (Factorial)
  if (strategy === OptimizationStrategy.ITERATIVE_REWRITE) {
    return `
public long ${methodName}(int n) {
    long result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}
`;
  }

  // 🧵 Case 2: String concatenation → StringBuilder
  if (strategy === OptimizationStrategy.STRING_BUILDER) {
    return `
public String ${methodName}(int n) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < n; i++) {
        sb.append(i);
    }
    return sb.toString();
}
`;
  }

  return "";
}
