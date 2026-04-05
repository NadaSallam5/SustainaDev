function processData(data) {
    let result = [];
    const seen = new Set();

    for (let i = 0; i < data.length; i++) {
        if (!seen.has(data[i])) {
            let count = 0;
            for (let j = 0; j < data.length; j++) {
                if (data[j] === data[i]) {
                    count++;
                }
            }
            result.push({ value: data[i], count: count });
            seen.add(data[i]);
        }
    }

    return result;
}