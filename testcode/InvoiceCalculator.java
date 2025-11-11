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
        int[] results = calculateTotalAndCount(prices);
        total = results[0];
        count = results[1];
        double avg = (count == 0) ? 0 : (double) total / count;

        double discount = calculateDiscount(total);

        double finalPrice = total - discount;

        printOrderDetails(count, total, discount, finalPrice, avg);

        System.out.println("Order processed.");
    }

    private int[] calculateTotalAndCount(int[] prices) {
        int total = 0;
        int count = 0;
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

    private double calculateDiscount(int total) {
        double discount = 0.0;
        if (total > 500) {
            discount = total * 0.1;
            System.out.println("Applying 10% discount for large order.");
        } else if (total > 200) {
            discount = total * 0.05;
            System.out.println("Applying 5% discount for medium order.");
        } else {
            System.out.println("No discount applied.");
        }
        return discount;
    }

    private void printOrderDetails(int count, int total, double discount, double finalPrice, double avg) {
        // 🧮 Simulate extra processing
        for (int i = 0; i < count; i++) {
            System.out.println("Verifying item #" + (i + 1));
        }
        System.out.println("Total price: " + total);
        System.out.println("Discount: " + discount);
        System.out.println("Final price: " + finalPrice);
        System.out.println("Average price: " + avg);
        System.out.println("Number of valid items: " + count);
    }
}