/**
 * Unoptimized 3-Sum (Before Refactoring)
 * Time Complexity: O(N^3)
 * SustainaDev Detection: NESTED_LOOPS (Level 3)
 */
function findTriplets(arr: number[]): number[][] {
    let result: number[][] = [];
    const n = arr.length;

    // Create a map to store the indices of each element
    const indexMap = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        if (!indexMap.has(arr[i])) {
            indexMap.set(arr[i], []);
        }
        indexMap.get(arr[i])!.push(i);
    }

    // Iterate through the array with two pointers
    for (let i = 0; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
            const target = -(arr[i] + arr[j]);
            if (indexMap.has(target)) {
                const indices = indexMap.get(target)!;
                for (const k of indices) {
                    if (k > j) {
                        result.push([arr[i], arr[j], arr[k]]);
                    }
                }
            }
        }
    }

    return result;
}
