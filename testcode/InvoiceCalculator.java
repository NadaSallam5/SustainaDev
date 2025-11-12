public class InvoiceCalculator {

    public static void main(String[] args) {
        int[] prices = { 100, 50, -20, 200 };
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    // Single method doing validation, calculation, printing, and discount logic
    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        // Loop through prices: validate and accumulate
        int[] results = validateAndAccumulate(prices);
        total = results[0];
        count = results[1];

        // Calculate average and print results
        double avg = (count == 0) ? 0 : (double) total / count;
        System.out.println("Total: $" + total);
        System.out.println("Count: " + count);
        System.out.println("Average price: $" + avg);
        System.out.println("Order processed successfully.");

        // Apply discount if total is high
        if (total > 500) {
            double discount = total * 0.1;
            System.out.println("Discount applied: $" + discount);
            System.out.println("Final total: $" + (total - discount));
        }
    }

    private int[] validateAndAccumulate(int[] prices) {
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