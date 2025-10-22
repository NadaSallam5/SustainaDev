public class LongMethodExample {

    public void processOrder(int[] prices) {
        int total = 0;
        int count = 0;
        extractedHelper();
    }}

    double avg = (count == 0) ? 0
            : (double) total
                    / count;System.out.println("Average price: "+avg);System.out.println("Order processed successfully.");
    }}

    private double calculateAverage(int total, int count) {
        return (count == 0) ? 0 : (double) total / count;
}
