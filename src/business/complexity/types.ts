export type BigONotation =
  | "O(1)"
  | "O(n)"
  | "O(n*m)"
  | "O(n log n)"
  | "O(n^2)"
  | "O(n^2 log n)"
  | "O(n^3)"
  | "O(2^n)"
  | "Unknown";

export interface AIComplexityResult {
  timeComplexity: string;
  spaceComplexity: string;
  explanation: string;
}

export interface OptimizationReport {
  metric: "time" | "space";   // ✅ NEW
  before: BigONotation;
  after: BigONotation;


  //before: string;
  //after: string;
  //improvement: string;
}
