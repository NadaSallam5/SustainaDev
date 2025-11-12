public class DiscountCalculator {

    public static double calculateDiscount(double price, double percentage) {
        return price - (price * (percentage / 100));
    }

    public static void applyDiscount() {
        double discountedPrice = calculateDiscount(200, 15);
        System.out.println(discountedPrice);
    }
}
