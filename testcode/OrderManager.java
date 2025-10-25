public class OrderManager {

    public static void main(String[] args) {
        int[] orderQuantities = { 5, -2, 10, 0, 3 };
        double[] unitPrices = { 20.0, 15.0, 8.0, 50.0, 12.0 };

        OrderManager manager = new OrderManager();
        double total = manager.processOrders(orderQuantities, unitPrices);

        System.out.println("Final total: $" + total);
    }

    public double processOrders(int[] quantities, double[] prices) {
        double total = 0;
        int validOrders = 0;

        for (int i = 0; i < quantities.length; i++) {
            int quantity = quantities[i];
            double price = prices[i];

            if (quantity <= 0) {
                System.out.println("⚠️ Invalid order skipped: Quantity = " + quantity);
                continue;
            }

            double subtotal = calculateSubtotalAndCheckLargeOrder(quantity, price);

            total += subtotal;
            validOrders++;
        }

        double avgOrder = (validOrders == 0) ? 0 : total / validOrders;

        System.out.println("✅ Processed " + validOrders + " valid orders.");
        System.out.println("📊 Average order value: $" + avgOrder);

        return total;
    }

    private double calculateSubtotalAndCheckLargeOrder(int quantity, double price) {
        double subtotal = quantity * price;

        if (subtotal > 100) {
            System.out.println("💰 Large order detected: $" + subtotal);
        }

        return subtotal;
    }
}