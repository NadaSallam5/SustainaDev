public class complexsample {

    // Function 1 - intentionally complex
    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            } else if (price < 0) {
                System.out.println("Invalid price: " + price);
            }
        }

        if (count > 0) {
            double avg = (double) total / count;
            System.out.println("Average price: " + avg);
        } else {
            System.out.println("No valid prices found.");
        }

        // simulate nested complexity
        for (int p : prices) {
            if (p > 100) {
                System.out.println("High value item detected: " + p);
            } else if (p > 50) {
                System.out.println("Medium value item detected: " + p);
            } else {
                System.out.println("Low value item detected: " + p);
            }
        }
    }

    // Function 2 - also complex enough for extraction
    public void generateReport(String[] items, int[] sales) {
        if (items == null || sales == null || items.length != sales.length) {
            System.out.println("Invalid report data");
            return;
        }

        int totalSales = 0;
        for (int s : sales) {
            totalSales += s;
        }

        double avgSales = (double) totalSales / sales.length;
        System.out.println("Average sales per item: " + avgSales);

        for (int i = 0; i < items.length; i++) {
            String status = sales[i] > avgSales ? "above average" : "below average";
            System.out.println(items[i] + " had " + status + " sales.");
        }

        // another nested if for complexity
        for (int sale : sales) {
            if (sale > 1000) {
                System.out.println("Top performer!");
            } else if (sale > 500) {
                System.out.println("Good performer.");
            } else {
                System.out.println("Needs improvement.");
            }
        }
    }
}
