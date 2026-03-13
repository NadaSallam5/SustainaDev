public class FibonacciCalculator {

    public int fib(int n) {
        int a = 0, b = 1, c = 0;
        for (int i = 2; i <= n; i++) {
            c = a + b;
            a = b;
            b = c;
        }
        return n <= 1 ? n : b;
    }
}