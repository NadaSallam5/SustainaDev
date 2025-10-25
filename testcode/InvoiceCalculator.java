public class InvoiceCalculator {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        calculateTotalAndCount(prices);

        double avg = calculateAverage(total, count);
        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private void calculateTotalAndCount(int[] prices) {
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