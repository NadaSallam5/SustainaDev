import java.util.HashSet;
import java.util.List;
import java.util.ArrayList;

public class DataMatcher {

    public List<String> findMatches(List<String> externalDatabase, List<String> localCache) {
        HashSet<String> localCacheSet = new HashSet<>(localCache);
        List<String> matches = new ArrayList<>();

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