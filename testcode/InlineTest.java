public class InlineTest {
    public static int add(int a, int b) {
        return a + b;
    }

    public static void test() {
        int result = add(5, 10);
        System.out.println(result);
    }
}
