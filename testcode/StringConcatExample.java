public class StringConcatExample {
    public String buildString(int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            sb.append(i);
        }
        return sb.toString();
    }
}