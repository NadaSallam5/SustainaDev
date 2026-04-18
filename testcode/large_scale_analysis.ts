// testOptimization.ts

// ========================================
// 1. NESTED LOOPS (should trigger NESTED_LOOPS)
// ========================================
export function findDuplicates(arr: number[]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();

  for (let num of arr) {
    if (seen.has(num)) {
      duplicates.add(num);
    } else {
      seen.add(num);
    }
  }

  return Array.from(duplicates);
}


// ========================================
// 2. RECURSION (should trigger RECURSION)
// ========================================
export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}


// ========================================
// 3. STRING CONCAT IN LOOP (should trigger STRING_BUILDER)
// ========================================
export function buildString(words: string[]): string {
  let result = "";

  for (let i = 0; i < words.length; i++) {
    result += words[i]; // inefficient concat
  }

  return result;
}


// ========================================
// 4. SORTING INSIDE LOOP (should trigger SORTING_IN_LOOP)
// ========================================
export function sortInsideLoop(arr: number[]): number[] {
  arr.sort((a, b) => a - b); // Sort once outside the loop
  return arr;
}


// ========================================
// 5. NORMAL FUNCTION (should NOT trigger anything)
// ========================================
export function sumArray(arr: number[]): number {
  let sum = 0;

  for (const num of arr) {
    sum += num;
  }

  return sum;
}


// ========================================
// 6. DEEP LOOP (loopDepth = 3)
// ========================================
export function threeLevelLoop(arr: number[]): number {
  let count = arr.length ** 3;
  return count;
}