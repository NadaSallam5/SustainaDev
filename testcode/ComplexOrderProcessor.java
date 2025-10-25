public class ComplexOrderProcessor {

    // Simple method (low complexity)
    public double calculateDiscount(double totalPrice) {
        if (totalPrice > 1000) {
            return totalPrice * 0.1;
        } else if (totalPrice > 500) {
            return totalPrice * 0.05;
        } else {
            return 0;
        }
    }

    // Moderate method
    public void sendNotification(String userEmail, String message) {
        if (userEmail != null && !userEmail.isEmpty()) {
            System.out.println("Sending email to " + userEmail);
            System.out.println("Message: " + message);
        } else {
            System.out.println("No user email found.");
        }
    }

    // Complex method (target for Extract Method)
    public void processOrder(int[] prices, boolean applyDiscount) {
        int total = 0;
        int itemCount = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                itemCount++;
            }
        }

        double avg = (itemCount == 0) ? 0 : (double) total / itemCount;

        System.out.println("Items count: " + itemCount);
        System.out.println("Average item price: " + avg);

        if (applyDiscount) {
            double discount = calculateDiscount(total);
            total -= discount;
            System.out.println("Discount applied: " + discount);
        }

        printFinalTotal(total);
        System.out.println("Order processed successfully.");
    }

    private void printFinalTotal(int total) {
        System.out.println("Final total: " + total);
    }

    // New method to print item count and average price
    private void printItemCountAndAverage(int itemCount, double avg) {
        System.out.println("Items count: " + itemCount);
        System.out.println("Average item price: " + avg);
    }

    // Another small helper
    public void printSummary(String name, int total) {
        System.out.println("Summary for " + name + ": $" + total);
    }
}