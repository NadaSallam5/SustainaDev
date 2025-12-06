public class InvoiceCalculator {

    public static void main(String[] args) {
        int[] prices = { 100, 50, -20, 200 };
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        int[] results = calculateTotalAndCount(prices, total, count);
        total = results[0];
        count = results[1];

        double average = (count == 0) ? 0 : (double) total / count;

        printVerification(count);
        System.out.println("Order processed.");
        System.out.println("Total price: " + total);
        System.out.println("Average price: " + average);
        System.out.println("Number of valid items: " + count);
    }

    private int[] calculateTotalAndCount(int[] prices, int total, int count) {
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

    private void printVerification(int count) {
        for (int i = 0; i < count; i++) {
            System.out.println("Verifying item #" + (i + 1));
        }
    }

}