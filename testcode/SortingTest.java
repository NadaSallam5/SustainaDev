import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        if (list == null || list.isEmpty()) {
            return 0;
        }

        // Sort the list once outside the loop
        Collections.sort(list);

        int sum = 0;
        for (int i = 0; i < list.size(); i++) {
            sum += list.get(i);
        }

        return sum;
    }
}