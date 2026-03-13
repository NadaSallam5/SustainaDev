public class StringConcatBad {
    public static void main(String[] args) {
        String result = "";

        for (int i = 0; i < 10000; i++) {
            result += i;
        }

        System.out.println(result.length());
    }
}