public class DuplicateComputation {

    public int compute(int x) {
        int v = expensive(x);
        return v + v;
    }

    private int expensive(int x) {
        try { Thread.sleep(10); } catch (Exception e) {}
        return x * x;
    }
}