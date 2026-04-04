function processData(data) {
    let result = new Map();

    for (let i = 0; i < data.length; i++) {
        if (!result.has(data[i])) {
            result.set(data[i], 1);
        } else {
            result.set(data[i], result.get(data[i]) + 1);
        }
    }

    return Array.from(result.entries()).map(([value, count]) => ({ value, count }));
}