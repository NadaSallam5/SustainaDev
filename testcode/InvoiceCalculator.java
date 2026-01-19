public class InvoiceCalculator {

    public static void main(String[] args) {
        int[] prices = { 100, 50, -20, 200 };
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else {
                System.out.println("Invalid price skipped: " + price);
            }

            double average = calculateAverage(total, count);

            printVerification(count);
            System.out.println("Order processed.");
            System.out.println("Total price: " + total);
            System.out.println("Average price: " + average);
            System.out.println("Number of valid items: " + count);
        }
    }

    private void printVerification(int count) {
        for (int i = 0; i < count; i++) {
            System.out.println("Verifying item #" + (i + 1));
        }
    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }
}