import java.util.*;

class FactorialCalculator {

    public long calculateFactorial(int n) {
        // Base case
        if (n <= 1) {
            return 1;
        }
        
        // Initialize result variable
        long result = 1;

        // Iterative loop to calculate factorial
        for (int i = 2; i <= n; i++) {
            result *= i;
        }

        return result;
    }
}