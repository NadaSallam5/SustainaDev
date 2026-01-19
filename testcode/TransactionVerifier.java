import java.util.HashSet;
import java.util.List;
import java.util.ArrayList;

/**
 * SustainaDev Test Case 3: Algorithmic Efficiency & Resource Savings
 * Targets: O(N*M) -> O(N+M) for list reconciliation.
 */
public class TransactionVerifier {
    public List<String> findMissingTransactions(List<String> masterList, List<String> processedList) {
        HashSet<String> processedSet = new HashSet<>(processedList);
        List<String> missing = new ArrayList<>();

        // TRIGGER: Nested loops. For every master transaction,
        // we check every processed transaction.
        // On large datasets, this significantly increases CPU cycles.
        for (String masterId : masterList) {
            if (!processedSet.contains(masterId)) {
                missing.add(masterId);
            }
        }
        return missing;
    }
}