public class InvoiceCalculator {

    public static void main(String[] args) {
        // 🧪 Sample input
        int[] prices = { 100, 50, -20, 200 };

        // Run the unrefactored process
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int sum = 0;
        int count = 0;

        int[] results = calculateTotalAndCount(prices);
        sum = results[0];
        count = results[1];

        double average = (count == 0) ? 0 : (double) sum / count;
        System.out.println("Average price: " + average);
        System.out.println("Order processed successfully.");
    }

    private int[] calculateTotalAndCount(int[] prices) {
        int sum = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                sum += price;
                count++;
            } else {
                System.out.println("Invalid price skipped: ");
            }
        }
        return new int[] { sum, count };
    }

}