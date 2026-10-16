export declare const DELIVERY_WORKFLOW_TOOLS: readonly string[];
export type DeliveryReadinessReport = {
  ready: boolean;
  missingTokenTools: string[];
  missingCoworkerTools: string[];
  unavailableTools: string[];
};
export declare function deliveryReadinessFromDiscovery(value: unknown): DeliveryReadinessReport;
