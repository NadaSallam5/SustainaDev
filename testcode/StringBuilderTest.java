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

    public String generateInvoiceHtml(Invoice invoice) {
        StringBuilder html = new StringBuilder();
        html.append("<!DOCTYPE html>\n<html>\n<head>\n");
        html.append("<style>\n");
        html.append("  body { font-family: Arial, sans-serif; }\n");
        html.append("  .table { width: 100%; border-collapse: collapse; }\n");
        html.append("  .th, .td { padding: 8px; border-bottom: 1px solid #ddd; }\n");
        html.append("  .discount { color: red; font-size: 0.9em; }\n");
        html.append("</style>\n</head>\n<body>\n");

        html.append("<div class='header'>\n");
        html.append("  <h1>Invoice #").append(invoice.invoiceId).append("</h1>\n");
        html.append("  <p>Date: ").append(invoice.date.format(DateTimeFormatter.ISO_LOCAL_DATE)).append("</p>\n");
        html.append("  <p>Customer: ").append(invoice.customerName).append("</p>\n");
        html.append("  <p>Status: ")
                .append(invoice.status.equals("PAID") ? "<strong>PAID</strong>" : "<em>PENDING</em>").append("</p>\n");
        html.append("</div>\n");

        html.append("<table class='table'>\n");
        html.append(
                "  <tr><th class='th'>Item</th><th class='th'>Qty</th><th class='th'>Price</th><th class='th'>Total</th></tr>\n");

        double invoiceTotal = 0.0;

        if (invoice.lineItems != null && !invoice.lineItems.isEmpty()) {
            for (int i = 0; i < invoice.lineItems.size(); i++) {
                LineItem item = invoice.lineItems.get(i);

                String rowColor = (i % 2 == 0) ? "#ffffff" : "#f9f9f9";
                html.append("  <tr style='background-color: ").append(rowColor).append(";'>\n");

                html.append("    <td class='td'>");
                html.append(item.description);
                if (item.isDiscounted) {
                    html.append("<br/><span class='discount'>(Discount Applied)</span>");
                }
                html.append("</td>\n");

                html.append("    <td class='td'>").append(item.quantity).append("</td>\n");

                double rowTotal = item.quantity * item.unitPrice;
                if (item.isDiscounted) {
                    html.append("    <td class='td'><s>$").append(item.unitPrice).append("</s> $")
                            .append(item.unitPrice - item.discountAmount).append("</td>\n");
                    rowTotal = item.quantity * (item.unitPrice - item.discountAmount);
                } else {
                    html.append("    <td class='td'>$").append(item.unitPrice).append("</td>\n");
                }

                html.append("    <td class='td'>$").append(String.format("%.2f", rowTotal)).append("</td>\n");
                html.append("  </tr>\n");

                invoiceTotal += rowTotal;
            }
        } else {
            html.append("  <tr><td class='td' colspan='4' style='text-align:center;'>No Items Found</td></tr>\n");
        }

        html.append("</table>\n");

        html.append("<div class='footer' style='margin-top: 20px; text-align: right;'>\n");
        html.append("  <h3>Total Due: $").append(String.format("%.2f", invoiceTotal)).append("</h3>\n");

        if ("PAID".equals(invoice.status)) {
            html.append("  <p>Thank you for your business!</p>\n");
        } else {
            html.append("  <p>Please remit payment within 30 days.</p>\n");
            html.append("  <p class='warning'>Late fees apply after ")
                    .append(invoice.date.plusDays(30).format(DateTimeFormatter.ISO_LOCAL_DATE)).append(".</p>\n");
        }
        html.append("</div>\n");

        html.append("</body>\n</html>");

        return html.toString();
    }
}
