public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 203 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int sum = 0;
        int count = 0;

        int[] results = processPrices(prices);
        sum = results[0];
        count = results[1];

        double avg = (count == 0) ? 0 : (double) sum / count;

        printResults(sum, count, avg);
    }

    private int[] processPrices(int[] prices) {
        int sum = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                sum += price;
                count++;
            } else {
                System.out.println("Invalid price skipped: " + price);
            }
        }
        return new int[] { sum, count };
    }

    private void printResults(int sum, int count, double avg) {
        System.out.println("Total price: " + sum);
        System.out.println("Count of valid prices: " + count);
        System.out.println("Average price: " + avg);
        System.out.println("Order processed successfully.");
    }

}