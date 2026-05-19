public class FactorialCalculator {

    public long calculateFactorial(int n) {
        // Base case
        if (n <= 1) {
            return 1;
        }

        long result = 1;
        for (int i = 2; i <= n; i++) {
            result *= i;
        }
        return result;
    }
}