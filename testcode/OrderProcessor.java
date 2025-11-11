public class OrderProcessor {

    public static void main(String[] args) {
        OrderProcessor processor = new OrderProcessor();
        double[] itemPrices = { 10.5, 25.0, 5.75, 40.0 };
        double finalTotal = processor.calculateTotal(itemPrices);
        System.out.println("Total: " + finalTotal);
    }

    // ✅ Clear, self-explanatory variable names
    public double calculateTotal(double[] prices) {
        double t = 0;
        t = calculateSubtotal(prices, t);

        double discount = (t > 50) ? t * 0.1 : 0;
        return t - discount;
    }

    private double calculateSubtotal(double[] prices, double subtotal) {
        for (double price : prices) {
            if (price > 0) {
                subtotal += price;
            }
        }
        return subtotal;
    }
}