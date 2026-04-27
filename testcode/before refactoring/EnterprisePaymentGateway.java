import java.util.logging.Logger;

public class EnterprisePaymentGateway {

    private static final Logger LOGGER = Logger.getLogger(EnterprisePaymentGateway.class.getName());
    private static final int MAX_RETRIES = 5;

    public static class PaymentRequest {
        public String transactionId;
        public double amount;
        public String customerId;
        public String targetNode;
    }

    public static class PaymentResponse {
        public String status;
        public String errorMessage;

        public PaymentResponse(String status, String errorMessage) {
            this.status = status;
            this.errorMessage = errorMessage;
        }
    }

    public PaymentResponse processPayment(PaymentRequest request, int attemptCount) {

        // Safety base case
        if (attemptCount > MAX_RETRIES) {
            LOGGER.severe("Transaction " + request.transactionId + " failed after " + MAX_RETRIES + " attempts.");
            return new PaymentResponse("FAILED", "Max retries exceeded");
        }

        LOGGER.info("Attempt " + attemptCount + " to process payment for " + request.transactionId);

        try {
            // Simulated vulnerable network call
            boolean networkSuccess = simulateExternalHttpCall(request);

            if (networkSuccess) {
                LOGGER.info("Payment " + request.transactionId + " processed successfully.");
                return new PaymentResponse("SUCCESS", null);
            } else {
                throw new RuntimeException("503 Service Unavailable");
            }

        } catch (Exception e) {
            LOGGER.warning("Attempt " + attemptCount + " failed: " + e.getMessage() + ". Retrying...");

            // Artificial delay to prevent aggressive spamming
            try {
                Thread.sleep(500);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
            }

            // THE SMELL: Recursively calling itself instead of a simple loop!
            // This leaves the current thread's stack frame open in memory.
            return processPayment(request, attemptCount + 1);
        }
    }

    /**
     * Simulates a flakey external API.
     */
    private boolean simulateExternalHttpCall(PaymentRequest request) {
        // Randomly fails to simulate network instability
        return Math.random() > 0.7;
    }
}
