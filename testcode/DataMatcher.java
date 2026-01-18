import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public class DataMatcher {

    public List<String> findMatches(List<String> externalDatabase, List<String> localCache) {
        List<String> matches = new ArrayList<>();
        HashSet<String> localSet = new HashSet<>(localCache);

        // Single pass using a HashSet for O(N+M) complexity
        for (String externalId : externalDatabase) {
            if (localSet.contains(externalId)) {
                matches.add(externalId);
                System.out.println("Match found for ID: " + externalId);
            }
        }

        return matches;
    }
}