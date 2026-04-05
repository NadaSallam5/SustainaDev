public class FactorialCalculator {

    public long calculateFactorial(int n) {
        // Base case
        if (n <= 1) {
            return 1;
        }
        
        // TRIGGER: Recursive call
        // This creates a new stack frame for every integer, 
        // leading to high memory overhead.
        return n * calculateFactorial(n - 1);
    }
}