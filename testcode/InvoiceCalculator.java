public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 200 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int[] results = processPrices(prices);
        int total = results[0];
        int count = results[1];

        double avg = calculateAveragePrice(total, count);

        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

    private int[] processPrices(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else {
                handleInvalidPrice(price);
            }
        }
        return new int[] { total, count };
    }

    private double calculateAveragePrice(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private void handleInvalidPrice(int price) {
        System.out.println("⚠️ Invalid price skipped: " + price);
    }
}