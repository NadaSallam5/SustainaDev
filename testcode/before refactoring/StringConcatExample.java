public class StringConcatExample {
    public String buildString(int n) {
        String s = "";
        for (int i = 0; i < n; i++) {
            s = s + i;
        }
        return s;
    }
}