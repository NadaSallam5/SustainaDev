import java.util.Arrays;

public class FactorialCalculator {

    public long calculateFactorial(int n) {
        // Base case
        if (n <= 1) {
            return 1;
        }
        
        // Initialize result to 1
        long result = 1;
        
        // Iterative loop from 2 to n
        for (int i = 2; i <= n; i++) {
            result *= i;
        }
        
        return result;
    }

    public static void main(String[] args) {
        FactorialCalculator calculator = new FactorialCalculator();
        System.out.println(calculator.calculateFactorial(5)); // Output: 120
    }
}