/**
 * SustainaDev Test Suite: JavaScript Performance Smells
 */

/**
 * Smell: STRING_BUILDER (O(N^2) string building)
 * In JavaScript, strings are immutable, so this creates a new string 
 * object in every iteration of the loop.
 */
function buildReportLog(entries) {
    let logStr = "";

    for (let i = 0; i < entries.length; i++) {
        logStr += "Entry ID: " + entries[i].id + " | Status: " + entries[i].status + "\n";
    }

    return logStr;
}

/**
 * Smell: NESTED_LOOPS (O(N^2))
 * Finding duplicates using two nested loops.
 */
function findDuplicateIDs(ids) {
    const duplicates = [];

    // Highly inefficient O(N^2) algorithm
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            if (ids[i] === ids[j]) {
                // Another hidden O(N) loop here
                if (!duplicates.includes(ids[i])) {
                    duplicates.push(ids[i]);
                }
            }
        }
    }

    return duplicates;
}

// Mock Data for Testing
const testData = [
    { id: 101, status: "SUCCESS" },
    { id: 102, status: "PENDING" },
    { id: 103, status: "FAILURE" }
];

const testIDs = [1, 2, 3, 2, 4, 5, 1];

console.log("--- SustainaDev JS Test ---");
console.log(buildReportLog(testData));
console.log("Duplicates Found:", findDuplicateIDs(testIDs));
