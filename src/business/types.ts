export interface MethodFacts {
  // existing (KEEP)
  methodName: string;
  callsSelf: boolean;
  maxLoopDepth: number;
  cyclomaticComplexity: number;

  // new (ADD)
  isLinearRecursion: boolean;
  isPureAccumulation: boolean;
  hasOverlappingSubproblems: boolean;

  hasStringConcatInLoop: boolean;



  // ✅ NEW FOR SORTING
  hasSortingCall: boolean;     // Arrays.sort / Collections.sort / list.sort
  sortInsideLoop: boolean;     // Sorting call occurs inside a loop
}