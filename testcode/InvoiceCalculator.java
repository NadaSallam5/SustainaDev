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

        double avg = (count == 0) ? 0 : (double) total / count;
        System.out.println("Average price: " + avg);
        System.out.println("Order processed successfully.");
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

}