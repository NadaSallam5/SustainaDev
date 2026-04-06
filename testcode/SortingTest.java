import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        Collections.sort(list);  // 🔥 sorting once outside the loop (BETTER)
        int sum = 0;

        for (int i = 0; i < list.size(); i++) {
            sum += list.get(i);
        }

        return sum;
    }
}