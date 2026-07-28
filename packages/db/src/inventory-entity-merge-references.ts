export type InventoryEntityMergeReference = {
  model: string;
  table: string;
  field: string;
};

export const INVENTORY_ENTITY_MERGE_REFERENCES: {
  hard: readonly InventoryEntityMergeReference[];
  soft: readonly InventoryEntityMergeReference[];
} = {
  hard: [
    { model: "changeItem", table: "ChangeItem", field: "inventoryEntityId" },
    { model: "discoveredItem", table: "DiscoveredItem", field: "inventoryEntityId" },
    {
      model: "discoveredSoftwareEvidence",
      table: "DiscoveredSoftwareEvidence",
      field: "inventoryEntityId",
    },
    {
      model: "discoveryConnection",
      table: "DiscoveryConnection",
      field: "gatewayEntityId",
    },
    {
      model: "discoveryFingerprintObservation",
      table: "DiscoveryFingerprintObservation",
      field: "inventoryEntityId",
    },
    {
      model: "discoveryTriageDecision",
      table: "DiscoveryTriageDecision",
      field: "inventoryEntityId",
    },
    {
      model: "identityResolutionLog",
      table: "IdentityResolutionLog",
      field: "inventoryEntityId",
    },
    {
      model: "inventoryRelationship",
      table: "InventoryRelationship",
      field: "fromEntityId",
    },
    {
      model: "inventoryRelationship",
      table: "InventoryRelationship",
      field: "toEntityId",
    },
    {
      model: "portfolioQualityIssue",
      table: "PortfolioQualityIssue",
      field: "inventoryEntityId",
    },
  ],
  soft: [
    { model: "remoteAction", table: "RemoteAction", field: "inventoryEntityId" },
  ],
};
