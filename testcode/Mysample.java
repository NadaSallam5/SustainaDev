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
        double avg = calculateAveragePrice(total, count);
        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

    private double calculateAveragePrice(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }
}