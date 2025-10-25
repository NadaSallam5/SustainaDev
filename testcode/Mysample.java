public class Mysample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        double avg = calculateAverage(prices, total, count);

        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);

    }

    private double calculateAverage(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }
        return (count == 0) ? 0 : (double) total / count;
    }

}