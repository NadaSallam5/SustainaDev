public class InvoiceCalculator {

    public static void main(String[] args) {
        int[] prices = { 100, 50, -20, 0, 200, 300, -5, 40 };
        InvoiceCalculator calculator = new InvoiceCalculator();
        calculator.processOrder(prices);
    }

    // Intentionally violates SRP + long method + nested branches
    public void processOrder(int[] prices) {
        // --- Validation ---
        if (prices == null) {
            System.out.println("No prices provided.");
            return;
        }
        if (prices.length == 0) {
            System.out.println("Empty order.");
            return;
        }

        // --- Accumulators ---
        int total = 0;
        int count = 0;
        int invalidCount = 0;
        Integer min = null, max = null;

        // --- First pass: scan + accumulate + log issues ---
        for (int i = 0; i < prices.length; i++) {
            int price = prices[i];

            // Validate line item
            if (price <= 0) {
                if (price == 0) {
                    System.out.println("Skipped zero price at index " + i);
                } else {
                    System.out.println("Invalid negative price at index " + i + ": " + price);
                }
                invalidCount++;
                continue;
            }

            // Accumulate totals
            total += price;
            count++;

            // Track min/max
            if (min == null || price < min)
                min = price;
            if (max == null || price > max)
                max = price;

            // Extra noisy printing to increase “do-everything-here”
            if (price > 250) {
                System.out.println("High-value item detected: $" + price);
            } else if (price < 50) {
                System.out.println("Low-value item detected: $" + price);
            } else {
                System.out.println("Item: $" + price);
            }
        }

        // --- Early exit if nothing valid ---
        if (count == 0) {
            System.out.println("No valid prices to process. Invalid items: " + invalidCount);
            return;
        }

        // --- Average + basic summary printing ---
        double avg = (double) total / count;
        System.out.println("--------------- ORDER SUMMARY ---------------");
        System.out.println("Items processed: " + count + " (invalid: " + invalidCount + ")");
        System.out.println("Total before discount/tax: $" + total);
        System.out.println("Average price: $" + avg);
        System.out.println("Min price: $" + (min == null ? "-" : min));
        System.out.println("Max price: $" + (max == null ? "-" : max));

        // --- Tiered discount logic (more branches) ---
        double discountRate;
        if (total > 1000) {
            discountRate = 0.15;
            System.out.println("Tier: PLATINUM (15% discount)");
        } else if (total > 500) {
            discountRate = 0.10;
            System.out.println("Tier: GOLD (10% discount)");
        } else if (total > 250) {
            discountRate = 0.05;
            System.out.println("Tier: SILVER (5% discount)");
        } else {
            discountRate = 0.0;
            System.out.println("Tier: STANDARD (no discount)");
        }

        double discount = total * discountRate;
        double subtotalAfterDiscount = total - discount;
        System.out.println("Discount applied: $" + discount);
        System.out.println("Subtotal after discount: $" + subtotalAfterDiscount);

        // --- Tax & service fees (inline rule soup) ---
        double taxRate = (subtotalAfterDiscount > 300) ? 0.14 : 0.10; // pretend VAT rule
        double serviceFee = (count > 5) ? 25.0 : 10.0; // pretend handling fee
        double tax = subtotalAfterDiscount * taxRate;

        // “Free shipping” gimmick to add branching
        double shipping;
        if (subtotalAfterDiscount >= 600) {
            shipping = 0.0;
            System.out.println("Shipping: FREE");
        } else if (subtotalAfterDiscount >= 300) {
            shipping = 15.0;
            System.out.println("Shipping: $15");
        } else {
            shipping = 30.0;
            System.out.println("Shipping: $30");
        }

        // --- Final total ---
        double finalTotal = subtotalAfterDiscount + tax + shipping + serviceFee;

        // --- Second pass: print “invoice lines” (duplicated traversal by design) ---
        System.out.println("----------------- LINE ITEMS ----------------");
        for (int i = 0; i < prices.length; i++) {
            int itemPrice = prices[i];
            if (itemPrice > 0) {
                System.out.println("#" + (i + 1) + "  $" + itemPrice);
            } else {
                System.out.println("#" + (i + 1) + "  (invalid: " + itemPrice + ")");
            }
        }

        // --- Final printing ---
        System.out.println("----------------- CHARGES -------------------");
        System.out.println("Subtotal after discount: $" + subtotalAfterDiscount);
        System.out.println("Tax (" + (int) (taxRate * 100) + "%): $" + tax);
        System.out.println("Service fee: $" + serviceFee);
        System.out.println("Shipping: $" + shipping);
        System.out.println("---------------------------------------------");
        System.out.println("FINAL TOTAL: $" + finalTotal);
        System.out.println("Order processed successfully.");
    }

    private void printInvoiceLines(int[] prices) {
        System.out.println("----------------- LINE ITEMS ----------------");
        for (int i = 0; i < prices.length; i++) {
            int itemPrice = prices[i];
            if (itemPrice > 0) {
                System.out.println("#" + (i + 1) + "  $" + itemPrice);
            } else {
                System.out.println("#" + (i + 1) + "  (invalid: " + itemPrice + ")");
            }
        }
    }
}