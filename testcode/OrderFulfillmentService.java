
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

public class OrderFulfillmentService {

    private static final Logger LOGGER = Logger.getLogger(OrderFulfillmentService.class.getName());

    private final String regionCode;
    private final boolean priorityFulfillmentEnabled;

    // Tracks which orderIds have already been fulfilled this session
    private List<String> fulfilledOrderIds = new ArrayList<>();

    public OrderFulfillmentService(String regionCode, boolean priorityFulfillmentEnabled) {
        this.regionCode = regionCode;
        this.priorityFulfillmentEnabled = priorityFulfillmentEnabled;
    }

    // =========================================================================
    // DTOs
    // =========================================================================

    public static class CustomerOrder {
        public String orderId;
        public String customerId;
        public String productSku;
        public int quantityRequested;
        public boolean isPriority;
        public LocalDate orderDate;

        public CustomerOrder(String orderId, String customerId, String productSku, int quantityRequested,
                boolean isPriority) {
            this.orderId = orderId;
            this.customerId = customerId;
            this.productSku = productSku;
            this.quantityRequested = quantityRequested;
            this.isPriority = isPriority;
            this.orderDate = LocalDate.now();
        }
    }

    public static class WarehouseStock {
        public String productSku;
        public int availableUnits;
        public String warehouseId;
        public String shippingZone;

        public WarehouseStock(String productSku, int availableUnits, String warehouseId, String shippingZone) {
            this.productSku = productSku;
            this.availableUnits = availableUnits;
            this.warehouseId = warehouseId;
            this.shippingZone = shippingZone;
        }
    }

    public static class FulfillmentResult {
        public String orderId;
        public String status; // e.g. "FULFILLED", "PARTIALLY_FULFILLED", "OUT_OF_STOCK"
        public String warehouseId;
        public int allocatedQuantity;

        public FulfillmentResult(String orderId, String status, String warehouseId, int allocatedQuantity) {
            this.orderId = orderId;
            this.status = status;
            this.warehouseId = warehouseId;
            this.allocatedQuantity = allocatedQuantity;
        }
    }

    public static class ShippingCarrier {
        public String carrierId;
        public String coverageZone;
        public double costPerUnit;
        public int maxCapacityUnits;

        public ShippingCarrier(String carrierId, String coverageZone, double costPerUnit, int maxCapacityUnits) {
            this.carrierId = carrierId;
            this.coverageZone = coverageZone;
            this.costPerUnit = costPerUnit;
            this.maxCapacityUnits = maxCapacityUnits;
        }
    }

    public static class OrderShipment {
        public String orderId;
        public String carrierId;
        public double totalCost;
        public String status;

        public OrderShipment(String orderId, String carrierId, double totalCost, String status) {
            this.orderId = orderId;
            this.carrierId = carrierId;
            this.totalCost = totalCost;
            this.status = status;
        }
    }

    public static class CustomerProfile {
        public String customerId;
        public String loyaltyTier; // "GOLD", "SILVER", "STANDARD"
        public int totalOrdersPlaced;
        public String preferredRegion;

        public CustomerProfile(String customerId, String loyaltyTier, int totalOrdersPlaced, String preferredRegion) {
            this.customerId = customerId;
            this.loyaltyTier = loyaltyTier;
            this.totalOrdersPlaced = totalOrdersPlaced;
            this.preferredRegion = preferredRegion;
        }
    }

    public static class OrderEnrichment {
        public String orderId;
        public String loyaltyTier;
        public boolean isEligibleForDiscount;

        public OrderEnrichment(String orderId, String loyaltyTier, boolean isEligibleForDiscount) {
            this.orderId = orderId;
            this.loyaltyTier = loyaltyTier;
            this.isEligibleForDiscount = isEligibleForDiscount;
        }
    }

    public List<FulfillmentResult> allocateStockToOrders(
            List<CustomerOrder> orders,
            List<WarehouseStock> stockSnapshot) {

        LOGGER.info("[" + regionCode + "] Starting stock allocation for " + orders.size() + " orders.");
        List<FulfillmentResult> results = new ArrayList<>();

        for (CustomerOrder order : orders) {
            boolean stockFound = false;

            for (WarehouseStock stock : stockSnapshot) {
                if (order.productSku.equals(stock.productSku)) {
                    stockFound = true;

                    if (stock.availableUnits >= order.quantityRequested) {
                        results.add(new FulfillmentResult(
                                order.orderId, "FULFILLED", stock.warehouseId, order.quantityRequested));
                        fulfilledOrderIds.add(order.orderId);
                    } else if (stock.availableUnits > 0) {
                        results.add(new FulfillmentResult(
                                order.orderId, "PARTIALLY_FULFILLED", stock.warehouseId, stock.availableUnits));
                    }
                    break;
                }
            }

            if (!stockFound) {
                results.add(new FulfillmentResult(order.orderId, "OUT_OF_STOCK", null, 0));
                LOGGER.warning("No stock found for SKU: " + order.productSku);
            }
        }

        LOGGER.info("Stock allocation complete. " + results.size() + " results generated.");
        return results;
    }

    public List<OrderShipment> assignCarriersToFulfillments(
            List<FulfillmentResult> fulfillments,
            List<ShippingCarrier> availableCarriers,
            List<WarehouseStock> stockSnapshot) {

        LOGGER.info("Assigning carriers to " + fulfillments.size() + " fulfillments.");
        List<OrderShipment> shipments = new ArrayList<>();
        Map<String, String> warehouseToShippingZoneMap = new HashMap<>();

        // Build lookup map for warehouseId to shippingZone
        for (WarehouseStock stock : stockSnapshot) {
            if (!warehouseToShippingZoneMap.containsKey(stock.warehouseId)) {
                warehouseToShippingZoneMap.put(stock.warehouseId, stock.shippingZone);
            }
        }

        Map<String, ShippingCarrier> carrierByCoverageZone = new HashMap<>();

        // Build lookup map for coverageZone to best carrier
        for (ShippingCarrier carrier : availableCarriers) {
            if (!carrierByCoverageZone.containsKey(carrier.coverageZone)) {
                carrierByCoverageZone.put(carrier.coverageZone, carrier);
            }
        }

        for (FulfillmentResult fulfillment : fulfillments) {
            if (!"FULFILLED".equals(fulfillment.status)) {
                continue;
            }

            String shippingZone = warehouseToShippingZoneMap.get(fulfillment.warehouseId);
            if (shippingZone == null) {
                LOGGER.warning("Could not determine shipping zone for warehouse: " + fulfillment.warehouseId);
                shipments.add(new OrderShipment(fulfillment.orderId, null, 0.0, "NO_CARRIER"));
                continue;
            }

            ShippingCarrier bestCarrier = carrierByCoverageZone.get(shippingZone);
            if (bestCarrier != null) {
                double totalCost = bestCarrier.costPerUnit * fulfillment.allocatedQuantity;
                shipments.add(new OrderShipment(fulfillment.orderId, bestCarrier.carrierId, totalCost, "ASSIGNED"));
            } else {
                shipments.add(new OrderShipment(fulfillment.orderId, null, 0.0, "NO_CARRIER"));
            }
        }

        LOGGER.info("Carrier assignment complete. " + shipments.size() + " shipments created.");
        return shipments;
    }

    public List<OrderEnrichment> enrichOrdersWithLoyaltyData(
            List<CustomerOrder> orders,
            List<CustomerProfile> customerProfiles) {

        LOGGER.info("Enriching " + orders.size() + " orders with loyalty data.");
        List<OrderEnrichment> enrichments = new ArrayList<>();

        for (CustomerOrder order : orders) {
            boolean profileFound = false;

            for (CustomerProfile profile : customerProfiles) {
                if (order.customerId.equals(profile.customerId)) {
                    profileFound = true;
                    boolean isEligibleForDiscount = "GOLD".equals(profile.loyaltyTier)
                            && profile.totalOrdersPlaced >= 10;

                    enrichments.add(new OrderEnrichment(
                            order.orderId,
                            profile.loyaltyTier,
                            isEligibleForDiscount));
                    break;
                }
            }

            if (!profileFound) {
                enrichments.add(new OrderEnrichment(order.orderId, "STANDARD", false));
                LOGGER.warning("No profile found for customerId: " + order.customerId);
            }
        }

        LOGGER.info("Loyalty enrichment complete. " + enrichments.size() + " records produced.");
        return enrichments;
    }

    public boolean isOrderAlreadyFulfilled(String orderId) {
        return fulfilledOrderIds.contains(orderId);
    }

    public String getRegionCode() {
        return regionCode;
    }
}