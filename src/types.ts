export interface FunctionMetrics {
  name: string;
  ccn: number;
  nloc: number;
  tokenCount?: number;
  callCount?: number;
  content?: string; // 🧩 Add this line
}