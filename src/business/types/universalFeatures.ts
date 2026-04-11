export interface UniversalFeatures {
  loops: number
  loopDepth: number
  recursion: boolean
  recursiveCallCount: number   // ✅ add this line
  stringConcatInLoop: boolean
  sortingCalls: number
  sortingInsideLoop: boolean
  methodLength: number
}