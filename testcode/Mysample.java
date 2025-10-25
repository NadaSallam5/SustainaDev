public class Mysample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;

        for (int price : prices) {
            if (price > 0) {
                total += price;
                count++;
            }
            double avg = (count == 0) ? 0 : (double) total / count;

            printOrderDetails(avg);
        }

    }

    private void printOrderDetails(double avg) {
        System.out.println("Order processed successfully.");
        System.out.println("Average price: " + avg);
    }

}