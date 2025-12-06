export function buildExplanation(fnName: string, before: { ccn:number; nloc:number }, after: { ccn:number; nloc:number }) {
  const dCCN = before.ccn - after.ccn;
  const dNLOC = before.nloc - after.nloc;
  return `Refactoring: Extract Method on '${fnName}'. Reduces cognitive load and isolates responsibilities. Impact: CCN ↓ ${dCCN}, NLOC ↓ ${dNLOC}.`;
}
export function inlineExplanation(methodName: string) {
  return `Inlined method '${methodName}' to reduce unnecessary abstraction and improve readability.`;
}
