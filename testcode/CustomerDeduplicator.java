import java.util.List;
import java.util.ArrayList;
import java.util.HashSet;

/**
 * SustainaDev Test: In-place Deduplication
 * Goal: Optimize O(N^2) duplication check to O(N).
 */
public class CustomerDeduplicator {
    public List<String> getUniqueCustomers(List<String> rawList) {
        List<String> uniqueList = new ArrayList<>();
        HashSet<String> seen = new HashSet<>();

        for (String current : rawList) {
            if (!seen.contains(current)) {
                uniqueList.add(current);
                seen.add(current);
            }
        }

        return uniqueList;
    }
}