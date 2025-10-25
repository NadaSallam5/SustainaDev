public class InvoiceCalculator {

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

    }

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
    }

    private void updateTotals(int price, int[] totals) {
        if (price > 0) {
            totals[0] += price;
            totals[1]++;
        }
    }

}