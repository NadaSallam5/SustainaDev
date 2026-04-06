function processData(data) {
    let result = [];
    let countMap = new Map();

    for (let i = 0; i < data.length; i++) {
        if (!countMap.has(data[i])) {
            countMap.set(data[i], 1);
        } else {
            countMap.set(data[i], countMap.get(data[i]) + 1);
        }
    }

    for (let [value, count] of countMap) {
        result.push({ value: value, count: count });
    }

    return result;
}