public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 203 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        int[] results = processPrices(prices);
        total = results[0];
        count = results[1];

        double avg = calculateAverage(total, count);

        printResults(total, count, avg);
    }

    private int[] processPrices(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else {
                System.out.println("Invalid price skipped: " + price);
            }
        }
        return new int[] { total, count };
    }

    private void printResults(int total, int count, double avg) {
        System.out.println("Total price: " + total);
        System.out.println("Count of valid prices: " + count);
        System.out.println("Average price: " + avg);
        System.out.println("Order processed successfully.");
    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

}