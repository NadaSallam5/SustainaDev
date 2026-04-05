import java.util.List;
import java.util.ArrayList;

/**
 * SustainaDev Test: List Reconciliation
 * Goal: Optimize nested loop comparison and add HashSet import.
 */
public class InventoryReconciler {
    public List<String> findDiscrepancies(List<String> warehouseStock, List<String> systemRecords) {
        List<String> discrepancies = new ArrayList<>();

        // TRIGGER: O(N*M) - Every item in warehouse is checked against every system record.
        for (String stockItem : warehouseStock) {
            boolean found = false;
            for (String record : systemRecords) {
                if (stockItem.equals(record)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                discrepancies.add(stockItem);
            }
        }
        return discrepancies;
    }
}