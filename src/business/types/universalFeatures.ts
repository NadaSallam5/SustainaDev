export interface UniversalFeatures {
  loops: number;
  loopDepth: number;
  recursion: boolean;
   recursiveCallCount: number;
  stringConcatInLoop: boolean;
  sortingCalls: number;
  sortingInsideLoop: boolean;
  methodLength: number;
  hasNestedLoop: boolean;     // ✅ NEW
  hasHashMapLookup: boolean;
  usesStringBuilder: boolean;
    // ✅ NEW
}