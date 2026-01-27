import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        if (list == null || list.isEmpty()) {
            return 0; // Handle edge case of empty or null list
        }

        Collections.sort(list);  // Sort the list once outside the loop

        int sum = 0;
        for (int i = 0; i < list.size(); i++) {
            sum += list.get(i);
        }

        return sum;
    }
}