public class MethodFacts {

    // Existing (KEEP THEM)
    public String methodName;
    public boolean callsSelf;              // recursion detected
    public int maxLoopDepth;
    public int cyclomaticComplexity;

    // NEW: semantic recursion facts
    public boolean isLinearRecursion;       // exactly one recursive call
    public boolean isPureAccumulation;      // n * f(n-1), n + f(n-1), etc.
    public boolean hasOverlappingSubproblems; // Fibonacci-style reuse

    public boolean hasStringConcatInLoop;

    
}