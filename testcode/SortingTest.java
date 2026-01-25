import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        if (list == null || list.isEmpty()) {
            return 0; // Handle edge case of empty or null list
        }

        List<Integer> sortedList = new ArrayList<>(list); // Create a copy to avoid modifying the original list
        Collections.sort(sortedList);

        int sum = 0;
        for (int i = 0; i < list.size(); i++) {
            sum += sortedList.get(i);
        }

        return sum;
    }
}