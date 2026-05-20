export interface MethodFacts {
  methodName: string;
  callsSelf: boolean;
  maxLoopDepth: number;
  cyclomaticComplexity: number;

  isLinearRecursion: boolean;
  isPureAccumulation: boolean;
  hasOverlappingSubproblems: boolean;

  hasStringConcatInLoop: boolean;

  hasSortingCall: boolean;
  sortInsideLoop: boolean;
listParamCount: number;
  hasNestedLoop: boolean;      // ✅ NEW
hasHashMapLookup: boolean;  
usesStringBuilder: boolean; // ✅ NEW
}
