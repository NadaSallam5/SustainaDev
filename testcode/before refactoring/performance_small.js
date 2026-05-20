function processData(data) {
    let result = [];

    for (let i = 0; i < data.length; i++) {
        let count = 0;

        for (let j = 0; j < data.length; j++) {
            if (data[i] === data[j]) {
                count++;
            }
        }

        let exists = false;
        for (let k = 0; k < result.length; k++) {
            if (result[k].value === data[i]) {
                exists = true;
                break;
            }
        }

        if (!exists) {
            result.push({ value: data[i], count: count });
        }
    }

    return result;
}