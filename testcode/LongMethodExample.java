public class LongMethodExample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;
        calculateTotalAndCount();
    }}

    double avg = (count == 0) ? 0
            : (double) total
                    / count;System.out.println("Average price: "+avg);System.out.println("Order processed successfully.");
    }

    private void calculateTotalAndCount(int[] prices, int total, int count) {
        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
        }
    }
}
