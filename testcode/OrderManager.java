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
            double[] result = processOrder(quantities[i], prices[i]);
            total += result[0];
            validOrders += result[1];
        }

        double avgOrder = (validOrders == 0) ? 0 : total / validOrders;

        printOrderSummary(validOrders, avgOrder);

        return total;
    }

    private double calculateSubtotalAndCheckLargeOrder(int quantity, double price) {
        double subtotal = quantity * price;

        if (subtotal > 100) {
            System.out.println("💰 Large order detected: $" + subtotal);
        }

        return subtotal;
    }

    private void printOrderSummary(int validOrders, double avgOrder) {
        System.out.println("✅ Processed " + validOrders + " valid orders.");
        System.out.println("📊 Average order value: $" + avgOrder);
    }

    private double[] processOrder(int quantity, double price) {
        if (quantity <= 0) {
            System.out.println("⚠️ Invalid order skipped: Quantity = " + quantity);
            return new double[] { 0, 0 };
        }

        double subtotal = calculateSubtotalAndCheckLargeOrder(quantity, price);
        return new double[] { subtotal, 1 };
    }
}