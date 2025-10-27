public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 200 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        double avg = calculateAveragePrice(prices);

        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

    private double calculateAveragePrice(int[] prices) {
        int[] result = calculateTotalAndCount(prices);
        int total = result[0];
        int count = result[1];

        return (count == 0) ? 0 : (double) total / count;
    }

    private int[] calculateTotalAndCount(int[] prices) {
        int total = 0;
        int count = 0;

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