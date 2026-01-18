import java.util.List;
import java.util.ArrayList;

/**
 * SustainaDev Test: In-place Deduplication
 * Goal: Optimize O(N^2) duplication check to O(N).
 */
public class CustomerDeduplicator {
    public List<String> getUniqueCustomers(List<String> rawList) {
        List<String> uniqueList = new ArrayList<>();

        // TRIGGER: Nested loop comparison.
        for (int i = 0; i < rawList.size(); i++) {
            String current = rawList.get(i);
            boolean isDuplicate = false;
            for (int j = 0; j < uniqueList.size(); j++) {
                if (current.equals(uniqueList.get(j))) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                uniqueList.add(current);
            }
        }
        return uniqueList;
    }
}