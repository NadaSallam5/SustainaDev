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
   

    hasDuplicateComputation: boolean;
}
