import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class SortingTest {

    public static int badSortInsideLoop(List<Integer> list) {
        int sum = 0;
        List<Integer> sortedList = new ArrayList<>(list); // Create a copy of the original list

        for (int i = 0; i < list.size(); i++) {
            Collections.sort(sortedList);  // Sort the copied list
            sum += sortedList.get(i);
        }

        return sum;
    }
}