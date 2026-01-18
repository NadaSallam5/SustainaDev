import java.util.HashSet;
import java.util.List;
import java.util.ArrayList;

/**
 * SustainaDev Test Case 2: Sustainability & Imports
 * Targets: O(N^2) -> O(N) using HashSet
 */
public class DuplicateDetector {
    public List<String> findDuplicates(List<String> inputData) {
        List<String> duplicates = new ArrayList<>();
        HashSet<String> seen = new HashSet<>();

        // TRIGGER: Comparing every item to every other item.
        // The AI should replace this with a HashSet and add the missing import.
        for (String item : inputData) {
            if (!seen.add(item)) { // If add returns false, it means the item is already in the set
                duplicates.add(item);
            }
        }
        return duplicates;
    }
}