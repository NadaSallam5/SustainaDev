export function generateIterativeRewrite(methodName: string) {
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
