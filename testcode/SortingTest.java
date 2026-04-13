import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        int sum = 0;

        for (int i = 0; i < list.size(); i++) {
            Collections.sort(list);  // 🔥 sorting inside loop (VERY BAD)
            sum += list.get(i);
        }

        return sum;
    }
}