import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/**
 * SustainaDev Test: List Reconciliation
 * Goal: Optimize nested loop comparison and add HashSet import.
 */
public class InventoryReconciler {
    public List<String> findDiscrepancies(List<String> warehouseStock, List<String> systemRecords) {
        List<String> discrepancies = new ArrayList<>();
        HashSet<String> systemRecordsSet = new HashSet<>(systemRecords);

        // TRIGGER: O(N+M) - Every item in warehouse is checked against the set of
        // system records.
        for (String stockItem : warehouseStock) {
            if (!systemRecordsSet.contains(stockItem)) {
                discrepancies.add(stockItem);
            }
        }
        return discrepancies;
    }
}