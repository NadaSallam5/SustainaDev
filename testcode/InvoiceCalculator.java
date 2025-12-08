public class InvoiceCalculator {

    public static void main(String[] args) {
        int[] prices = { 100, 50, -20, 200 };
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    // ✅ THIS METHOD IS GOOD FOR TESTING EXTRACT METHOD
    // It has multiple responsibilities: validation, calculation, and printing
    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        // Loop through prices and calculate
        int[] results = calculateTotalAndCount(prices);
        total = results[0];
        count = results[1];

        // Calculate average
        double avg = (count == 0) ? 0 : (double) total / count;

        // Print results
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

    private int[] calculateTotalAndCount(int[] prices) {
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