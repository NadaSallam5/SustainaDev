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
        printPriceCategories(prices);
    }

    private void printPriceCategories(int[] prices) {
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

}