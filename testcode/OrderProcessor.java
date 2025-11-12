public class OrderProcessor {

    public static void main(String[] args) {
        OrderProcessor processor = new OrderProcessor();
        double[] itemPrices = { 10.5, 25.0, 5.75, 40.0 };
        double finalTotal = processor.calculateTotal(itemPrices);
        System.out.println("Total: " + finalTotal);
    }

    public double calculateTotal(double[] prices) {
        double total = 0;
        for (double itemPrice : prices) {
            if (itemPrice > 0) {
                total += itemPrice;
            }
        }

        double discount = (total > 50) ? total * 0.1 : 0;
        return total - discount;
    }
}