function findTriplets(arr: number[]): number[][] {
    let result: number[][] = [];
    const seenPairs = new Map<number, Set<number>>();

    for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
            const sum = -(arr[i] + arr[j]);
            if (seenPairs.has(sum)) {
                seenPairs.get(sum)!.forEach(k => result.push([arr[i], arr[j], k]));
            }
        }

        for (let k = 0; k < i; k++) {
            const currentSum = arr[i] + arr[k];
            if (!seenPairs.has(currentSum)) {
                seenPairs.set(currentSum, new Set<number>());
            }
            seenPairs.get(currentSum)!.add(arr[k]);
        }
    }

    return result;
}