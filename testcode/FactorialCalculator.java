public class FactorialCalculator {

    public long calculateFactorial(int n) {
        // Initialize result to 1
        long result = 1;

        // Use a loop to calculate factorial iteratively
        for (int i = 2; i <= n; i++) {
            result *= i;
        }

        return result;
    }
}