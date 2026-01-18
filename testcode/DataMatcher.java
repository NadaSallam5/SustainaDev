import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public class DataMatcher {

    public List<String> findMatches(List<String> externalDatabase, List<String> localCache) {
        List<String> matches = new ArrayList<>();
        HashSet<String> localCacheSet = new HashSet<>(localCache);

        // TRIGGER: Nested loop results in O(N*M) complexity.
        // Your extension should detect this pattern and suggest an
        // "Algorithmic Optimization" using a HashSet.
        for (String externalId : externalDatabase) {
            if (localCacheSet.contains(externalId)) {
                matches.add(externalId);
                // I/O inside loops further increases energy footprint
                System.out.println("Match found for ID: " + externalId);
            }
        }

        return matches;
    }
}