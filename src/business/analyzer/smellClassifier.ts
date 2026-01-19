import type { FnInfo } from './lizardRunner';

// make it easy to trigger in demo: small CCN or modest NLOC
export function chooseRefactor(fn: FnInfo) {
  if (fn.ccn >= 3 || fn.nloc >= 25) {
    return { type: 'Extract Method' as const, confidence: 0.9 };
  }
  return { type: 'None' as const, confidence: 0.4 };
}
