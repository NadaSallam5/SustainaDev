public class Mysample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }

        double avg = calculateAverage(total, count);
        printOrderSummary(avg);
        System.out.println("Order processed successfully.");
    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private void printOrderSummary(double avg) {
        System.out.println("Average price: " + avg);
    }

    private int[] calculateTotalAndCount(int[] prices) {
        int total = 0;
        int count = 0;
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }
        return new int[] { total, count };
    }
}