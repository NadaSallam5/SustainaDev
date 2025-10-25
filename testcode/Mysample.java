public class Mysample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        int[] results = calculateTotalAndCount(prices, total, count);
        total = results[0];
        count = results[1];

        double avg = (count == 0) ? 0 : (double) total / count;

        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);

    }

    private int[] calculateAverage(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }
        return new int[] { total, count };
    }

    private int[] calculateTotalAndCount(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }
        return new int[] { total, count };
    }

}