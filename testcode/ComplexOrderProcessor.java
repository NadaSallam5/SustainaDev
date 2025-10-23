public class InvoiceCalculator {

    public void calculateInvoice(double[] items, boolean applyDiscount) {
        double subtotal = 0;

        for (double item : items) {
            if (item > 0) {
                subtotal += item;
            }
        }

        System.out.println("Subtotal: " + subtotal);

        if (applyDiscount) {
            double discount = subtotal * 0.1;
            subtotal -= discount;
            System.out.println("Discount applied: " + discount);
        }

        double tax = subtotal * 0.05;
        double total = subtotal + tax;

        System.out.println("Tax: " + tax);
        System.out.println("Total: " + total);
    }
}
