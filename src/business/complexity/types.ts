export type BigONotation =
  | "O(1)"
  | "O(n)"
  | "O(n log n)"      // ✅ NEW
  | "O(n^2)"
  | "O(n^2 log n)"    // ✅ NEW
  | "O(n^3)"
  | "O(2^n)"
  | "Unknown";

export interface OptimizationReport {
  metric: "time" | "space";   // ✅ NEW
  before: BigONotation;
  after: BigONotation;
  improvement: string;
}
