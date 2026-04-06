import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.logging.Logger;

import before refactoring.OrderFulfillmentService.CustomerOrder;
import before refactoring.OrderFulfillmentService.CustomerProfile;
import before refactoring.OrderFulfillmentService.FulfillmentResult;
import before refactoring.OrderFulfillmentService.OrderEnrichment;
import before refactoring.OrderFulfillmentService.OrderShipment;
import before refactoring.OrderFulfillmentService.ShippingCarrier;

public class GreenComputingOptimizer {

    private final String regionCode;
    private final boolean priorityFulfillmentEnabled;
    // Tracks which orderIds have already been fulfilled this session
    private List<String> fulfilledOrderIds = new ArrayList<>();

    /**
     * Assigns the cheapest available shipping carrier for each fulfilled order
     * based on the warehouse's shipping zone.
     *
     * ⚠️ WARNING: This uses an O(N^2) nested loop — every fulfillment result
     * scans through every carrier to find a zone match.
     */
    public List<OrderShipment> assignCarriersToFulfillments(
            List<FulfillmentResult> fulfillments,
            List<ShippingCarrier> availableCarriers,
            List<WarehouseStock> stockSnapshot) {

        LOGGER.info("Assigning carriers to " + fulfillments.size() + " fulfillments.");
        List<OrderShipment> shipments = new ArrayList<>();

        // Step 1: Create a map of shipping zones to their corresponding carriers
        Map<String, List<ShippingCarrier>> zoneToCarriersMap = new HashMap<>();
        for (ShippingCarrier carrier : availableCarriers) {
            String coverageZone = carrier.coverageZone;
            if (!zoneToCarriersMap.containsKey(coverageZone)) {
                zoneToCarriersMap.put(coverageZone, new ArrayList<>());
            }
            zoneToCarriersMap.get(coverageZone).add(carrier);
        }

        // Step 2: Assign carriers to each fulfillment
        for (FulfillmentResult fulfillment : fulfillments) {
            if (!"FULFILLED".equals(fulfillment.status)) {
                continue;
            }

            // Find the shipping zone for this warehouse
            String shippingZone = null;
            for (WarehouseStock stock : stockSnapshot) {
                if (fulfillment.warehouseId != null && fulfillment.warehouseId.equals(stock.warehouseId)) {
                    shippingZone = stock.shippingZone;
                    break;
                }
            }

            if (shippingZone == null) {
                LOGGER.warning("Could not determine shipping zone for warehouse: " + fulfillment.warehouseId);
                shipments.add(new OrderShipment(fulfillment.orderId, null, 0.0, "NO_CARRIER"));
                continue;
            }

            // Find the cheapest carrier for that zone
            List<ShippingCarrier> carriers = zoneToCarriersMap.get(shippingZone);
            if (carriers != null) {
                ShippingCarrier bestCarrier = null;
                for (ShippingCarrier carrier : carriers) {
                    if (bestCarrier == null || carrier.costPerUnit < bestCarrier.costPerUnit) {
                        bestCarrier = carrier;
                    }
                }

                if (bestCarrier != null) {
                    double totalCost = bestCarrier.costPerUnit * fulfillment.allocatedQuantity;
                    shipments.add(new OrderShipment(fulfillment.orderId, bestCarrier.carrierId, totalCost, "ASSIGNED"));
                } else {
                    shipments.add(new OrderShipment(fulfillment.orderId, null, 0.0, "NO_CARRIER"));
                }
            } else {
                LOGGER.warning("No carriers found for shipping zone: " + shippingZone);
                shipments.add(new OrderShipment(fulfillment.orderId, null, 0.0, "NO_CARRIER"));
            }
        }

        LOGGER.info("Carrier assignment complete. " + shipments.size() + " shipments created.");
        return shipments;
    }

}

    // =========================================================================
    // TARGET METHOD 3 — O(N^2): Enrich order list with customer loyalty data
    //
    // For each order, the full customer profile list is scanned to find the
    // matching customer. This is the same brute-force O(N*M) pattern as the
    // others and should be replaced with a lookup map.
    // =========================================================================

    /**
     * Enriches each order with loyalty tier information from the customer profile
     * list. Orders from GOLD customers are eligible for a discount.
     *
     * ⚠️ WARNING: This uses an O(N^2) nested loop — every order triggers a
     * linear scan of the entire customer profile list.
     */
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
                // No customer profile exists — treat as a standard tier
                enrichments.add(new OrderEnrichment(order.orderId, "STANDARD", false));
                LOGGER.warning("No profile found for customerId: " + order.customerId);
            }
        }

        LOGGER.info("Loyalty enrichment complete. " + enrichments.size() + " records produced.");
        return enrichments;
    }

    // =========================================================================
    // Supporting utility methods
    // =========================================================================

    public boolean isOrderAlreadyFulfilled(String orderId) {
        return fulfilledOrderIds.contains(orderId);
    }

    public String getRegionCode() {
        return regionCode;
    }
}
