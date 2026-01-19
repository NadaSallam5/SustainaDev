import java.util.HashSet;
import java.util.List;
import java.util.ArrayList;

/**
 * SustainaDev Test: List Reconciliation
 * Goal: Optimize nested loop comparison and add HashSet import.
 */
public class InventoryReconciler {
    public List<String> findDiscrepancies(List<String> warehouseStock, List<String> systemRecords) {
        // Use a HashSet to store system records for O(1) average time complexity
        // lookups.
        HashSet<String> systemRecordSet = new HashSet<>(systemRecords);

        List<String> discrepancies = new ArrayList<>();

        // TRIGGER: O(N) - Each item in warehouse is checked against the HashSet.
        for (String stockItem : warehouseStock) {
            if (!systemRecordSet.contains(stockItem)) {
                discrepancies.add(stockItem);
            }
        }
        return discrepancies;
    }
}