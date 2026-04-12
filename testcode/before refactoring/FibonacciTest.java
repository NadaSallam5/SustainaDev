public class FibonacciTest {

    // ========================================
    // 1. RECURSIVE FIBONACCI (MAIN TEST)
    // Should trigger: recursion = true
    // ========================================
    public static int fibonacci(int n) {
        if (n <= 1) {
            return n;
        }

        return fibonacci(n - 1) + fibonacci(n - 2);
    }


    // ========================================
    // 2. ITERATIVE VERSION (CONTROL CASE)
    // Should NOT trigger recursion
    // ========================================
    public static int fibonacciIterative(int n) {
        if (n <= 1) return n;

        int a = 0, b = 1, c = 0;

        for (int i = 2; i <= n; i++) {
            c = a + b;
            a = b;
            b = c;
        }

        return b;
    }


    // ========================================
    // 3. MAIN METHOD FOR RUN TESTING
    // ========================================
    public static void main(String[] args) {
        int n = 6;

        System.out.println("Recursive Fibonacci: " + fibonacci(n));
        System.out.println("Iterative Fibonacci: " + fibonacciIterative(n));
    }
}
