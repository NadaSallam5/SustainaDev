// testComplexityOptimizations.ts

// ========================================
// 1. O(n²) - NESTED LOOPS
// Expected Optimization: Use Set
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
// 2. O(n³) - TRIPLE NESTED LOOPS
// Expected Optimization: Reduce unnecessary nesting
// ========================================
export function countTriplets(arr: number[]): number {
  let count = 0;
  const n = arr.length;

  // Create a map to store the frequency of each element
  const freqMap = new Map<number, number>();
  for (let num of arr) {
    if (freqMap.has(num)) {
      freqMap.set(num, freqMap.get(num)! + 1);
    } else {
      freqMap.set(num, 1);
    }
  }

  // Iterate through the array with two pointers
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      const sum = arr[i] + arr[j];
      count += freqMap.get(sum - arr[j])!;
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
  const length = numbers.length;

  for (let i = 0; i < length; i++) {
    let minIndex = i;
    for (let j = i + 1; j < length; j++) {
      if (numbers[j] < numbers[minIndex]) {
        minIndex = j;
      }
    }
    [numbers[i], numbers[minIndex]] = [numbers[minIndex], numbers[i]];
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
