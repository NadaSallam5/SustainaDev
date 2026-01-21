import java.util.List;

public class ListContainsTest {

    public int countMatches(List<String> a, List<String> b) {
        int count = 0;

        for (String x : a) {
            if (b.contains(x)) {
                count++;
            }
        }
        return count;
    }
}
