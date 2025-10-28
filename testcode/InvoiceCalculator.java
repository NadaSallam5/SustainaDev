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

        for (int price : prices) {
            int[] results = handlePrice(price, total, count);
            total = results[0];
            count = results[1];

            calculateAndPrintAverage(total, count);
        }
    }

    private void calculateAndPrintAverage(int total, int count) {
        double avg = (count == 0) ? 0 : (double) total / count;
        System.out.println("Average price: " + avg);
        System.out.println("Order processed successfully.");
    }

    private void handleInvalidPrice() {
        System.out.println("Invalid price skipped: ");
    }

    private int[] handlePrice(int price, int total, int count) {
        if (price > 0) {
            total += price;
            count++;
        } else {
            handleInvalidPrice();
        }
        return new int[] { total, count };
    }
}