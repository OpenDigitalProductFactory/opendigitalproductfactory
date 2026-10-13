// The contract's single source lives in @dpf/integration-shared so the web
// program and dependency-free preview scripts can consume it without pulling
// dpf-bootstrap source.
export {
  DELIVERY_WORKFLOW_TOOLS,
  deliveryReadinessFromDiscovery,
  type DeliveryReadinessReport,
} from "@dpf/integration-shared/delivery-readiness-contract";
