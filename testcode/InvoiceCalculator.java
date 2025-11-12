public class InvoiceCalculator {

    public static void main(String[] args) {
        InvoiceCalculator calc = new InvoiceCalculator();
        calc.processOrder(new int[] { 100, 50, -20, 200 });
    }

    // 🧩 High CCN version: all logic inline
    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        int[] results = processPrices(prices, total, count);
        total = results[0];
        count = results[1];

        if (count > 0) {
            double average = (double) total / count;
            if (average > 100) {
                System.out.println("High average order!");
            } else {
                System.out.println("Normal order.");
            }
        } else {
            System.out.println("No valid prices found.");
        }

        System.out.println("Final total: $" + total);
    }

    private int[] processPrices(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else if (price == 0) {
                System.out.println("Zero price ignored");
            } else {
                System.out.println("Invalid price skipped: " + price);
            }
        }
        return new int[] { total, count };
    }
}