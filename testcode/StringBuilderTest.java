import java.util.List;
import java.time.format.DateTimeFormatter;

/**
 * A highly complex test class demonstrating the STRING_BUILDER sustainability
 * smell.
 * 
 * This simulates a realistic enterprise codebase where deep structural strings
 * (like HTML/JSON payloads)
 * are constructed manually using aggressive `+` concatenation intermixed with
 * conditionals, mathematical
 * calculations, and loops.
 */
public class StringBuilderTest {

    public static class Invoice {
        public String customerName;
        public String invoiceId;
        public java.time.LocalDate date;
        public String status;
        public List<LineItem> lineItems;
    }

    public static class LineItem {
        public String description;
        public int quantity;
        public double unitPrice;
        public boolean isDiscounted;
        public double discountAmount;
    }

    /**
     * Target: A complex HTML Invoice Email Generator
     * 
     * SUSTAINABILITY SMELL: Aggressive O(N^2) memory reallocation. Since Strings
     * are immutable in Java,
     * every `html +=` recreates the entire HTML string in memory.
     * 
     * EXPECTED: The AI must replace the `String html` mutation with a single
     * `StringBuilder html = new StringBuilder();`
     * and flawlessly map all nested loops, ternary operators, and logical blocks to
     * `.append()` calls.
     */
    public String generateInvoiceHtml(Invoice invoice) {
        String html = "<!DOCTYPE html>\n<html>\n<head>\n";
        html += "<style>\n";
        html += "  body { font-family: Arial, sans-serif; }\n";
        html += "  .table { width: 100%; border-collapse: collapse; }\n";
        html += "  .th, .td { padding: 8px; border-bottom: 1px solid #ddd; }\n";
        html += "  .discount { color: red; font-size: 0.9em; }\n";
        html += "</style>\n</head>\n<body>\n";

        html += "<div class='header'>\n";
        html += "  <h1>Invoice #" + invoice.invoiceId + "</h1>\n";
        html += "  <p>Date: " + invoice.date.format(DateTimeFormatter.ISO_LOCAL_DATE) + "</p>\n";
        html += "  <p>Customer: " + invoice.customerName + "</p>\n";
        html += "  <p>Status: " + (invoice.status.equals("PAID") ? "<strong>PAID</strong>" : "<em>PENDING</em>")
                + "</p>\n";
        html += "</div>\n";

        html += "<table class='table'>\n";
        html += "  <tr><th class='th'>Item</th><th class='th'>Qty</th><th class='th'>Price</th><th class='th'>Total</th></tr>\n";

        double invoiceTotal = 0.0;

        if (invoice.lineItems != null && !invoice.lineItems.isEmpty()) {
            for (int i = 0; i < invoice.lineItems.size(); i++) {
                LineItem item = invoice.lineItems.get(i);

                String rowColor = (i % 2 == 0) ? "#ffffff" : "#f9f9f9";
                html += "  <tr style='background-color: " + rowColor + ";'>\n";

                html += "    <td class='td'>";
                html += item.description;
                if (item.isDiscounted) {
                    html += "<br/><span class='discount'>(Discount Applied)</span>";
                }
                html += "</td>\n";

                html += "    <td class='td'>" + item.quantity + "</td>\n";

                double rowTotal = item.quantity * item.unitPrice;
                if (item.isDiscounted) {
                    html += "    <td class='td'><s>$" + item.unitPrice + "</s> $"
                            + (item.unitPrice - item.discountAmount) + "</td>\n";
                    rowTotal = item.quantity * (item.unitPrice - item.discountAmount);
                } else {
                    html += "    <td class='td'>$" + item.unitPrice + "</td>\n";
                }

                html += "    <td class='td'>$" + String.format("%.2f", rowTotal) + "</td>\n";
                html += "  </tr>\n";

                invoiceTotal += rowTotal;
            }
        } else {
            html += "  <tr><td class='td' colspan='4' style='text-align:center;'>No Items Found</td></tr>\n";
        }

        html += "</table>\n";

        html += "<div class='footer' style='margin-top: 20px; text-align: right;'>\n";
        html += "  <h3>Total Due: $" + String.format("%.2f", invoiceTotal) + "</h3>\n";

        if ("PAID".equals(invoice.status)) {
            html += "  <p>Thank you for your business!</p>\n";
        } else {
            html += "  <p>Please remit payment within 30 days.</p>\n";
            html += "  <p class='warning'>Late fees apply after "
                    + invoice.date.plusDays(30).format(DateTimeFormatter.ISO_LOCAL_DATE) + ".</p>\n";
        }
        html += "</div>\n";

        html += "</body>\n</html>";

        return html;
    }
}
