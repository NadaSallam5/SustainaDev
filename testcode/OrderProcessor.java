public class OrderProcessor {

    public static void main(String[] args) {
        OrderProcessor processor = new OrderProcessor();
        double[] itemPrices = { 10.5, 25.0, 5.75, 40.0 };
        double finalTotal = processor.calculateTotal(itemPrices);
        System.out.println("Total: " + finalTotal);
    }

    // ✅ Clear, self-explanatory variable names
    public double calculateTotal(double[] prices) {
        double total = 0;
        for (double p : prices) {
            if (p > 0) {
                total += p;
            }
        }

        double discount = (total > 50) ? total * 0.1 : 0;
        return total - discount;
    }
}