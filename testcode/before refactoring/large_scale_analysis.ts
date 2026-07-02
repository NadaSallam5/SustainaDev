// testComplexityOptimizations.ts

// ========================================
// 1. O(n²) - NESTED LOOPS
// Expected Optimization: Use Set
// ========================================
export function findDuplicates(arr: number[]): number[] {
  const duplicates: number[] = [];

  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j] && !duplicates.includes(arr[i])) {
        duplicates.push(arr[i]);
      }
    }
  }

  return duplicates;
}

// ========================================
// 2. O(n³) - TRIPLE NESTED LOOPS
// Expected Optimization: Reduce unnecessary nesting
// ========================================
export function countTriplets(arr: number[]): number {
  let count = 0;

  for (let i = 0; i < arr.length; i++) {
    for (let j = 0; j < arr.length; j++) {
      for (let k = 0; k < arr.length; k++) {
        if (arr[i] + arr[j] > arr[k]) {
          count++;
        }
      }
    }
  }

  return count;
}

// ========================================
// 3. SORTING INSIDE LOOP
// Expected Optimization: Sort once before the loop
// ========================================
export function processNumbers(numbers: number[]): number[] {
  const result: number[] = [];

  for (let i = 0; i < numbers.length; i++) {
    numbers.sort((a, b) => a - b);
    result.push(numbers[i]);
  }

  return result;
}

// ========================================
// NORMAL FUNCTION (Should NOT Trigger)
// ========================================
export function sum(numbers: number[]): number {
  let total = 0;

  for (const num of numbers) {
    total += num;
  }

  return total;
}