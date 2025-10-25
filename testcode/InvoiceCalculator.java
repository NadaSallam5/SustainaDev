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

        double avg = calculateAverage(total, count);

        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private int[] processPrices(int[] prices) {
        int total = 0;
        int count = 0;

        int[] processedResults = processValidPrices(prices, total, count);
        total = processedResults[0];
        count = processedResults[1];

        return new int[] { total, count };
    }

    private int[] processValidPrices(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else {
                System.out.println("⚠️ Invalid price skipped: " + price);
            }
        }
        return new int[] { total, count };
    }
}