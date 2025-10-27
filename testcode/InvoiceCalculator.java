public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 200 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        int[] results = handlePrice(prices, total, count);
        total = results[0];
        count = results[1];

        double avg = calculateAveragePrice(total, count);

        System.out.println("Average price: " + avg);
        System.out.println("Order processed successfully.");

    }

    private double calculateAveragePrice(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private int[] handlePrice(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else {
                System.out.println("Invalid price skipped: ");
            }
        }
        return new int[] { total, count };
    }
}