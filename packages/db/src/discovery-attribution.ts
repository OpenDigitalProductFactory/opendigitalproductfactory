export type InventoryQualityEntityInput = {
  entityKey: string;
  entityType: string;
  attributionStatus: "attributed" | "needs_review" | "unmapped" | "stale";
  taxonomyNodeId?: string | null;
  digitalProductId?: string | null;
  qualityStatus?: "warning" | "error";
};

export type InventoryQualityRelationshipInput = {
  relationshipKey: string;
  relationshipType: string;
  status?: "active" | "stale";
};

export type InventoryQualityIssue = {
  issueKey: string;
  issueType: string;
  severity: "warn" | "error";
  status: "open";
  summary: string;
  inventoryEntityKey?: string;
  inventoryRelationshipKey?: string;
};

export type InventoryQualityEvaluation = {
  issues: InventoryQualityIssue[];
};

export function evaluateInventoryQuality(
  entities: InventoryQualityEntityInput[],
  relationships: InventoryQualityRelationshipInput[] = [],
): InventoryQualityEvaluation {
  const issues: InventoryQualityIssue[] = [];

  for (const entity of entities) {
    if (entity.attributionStatus === "needs_review" || entity.attributionStatus === "unmapped") {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:attribution_missing`,
        issueType: "attribution_missing",
        severity: entity.qualityStatus === "error" ? "error" : "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} requires taxonomy or product attribution review`,
        inventoryEntityKey: entity.entityKey,
      });
    }

    if (entity.attributionStatus === "stale") {
      issues.push({
        issueKey: `inventory_entity:${entity.entityKey}:stale`,
        issueType: "stale_entity",
        severity: "warn",
        status: "open",
        summary: `${entity.entityType} ${entity.entityKey} was not confirmed in the latest discovery run`,
        inventoryEntityKey: entity.entityKey,
      });
    }
  }

  for (const relationship of relationships) {
    if (relationship.status === "stale") {
      issues.push({
        issueKey: `inventory_relationship:${relationship.relationshipKey}:stale`,
        issueType: "stale_relationship",
        severity: "warn",
        status: "open",
        summary: `${relationship.relationshipType} relationship ${relationship.relationshipKey} is stale`,
        inventoryRelationshipKey: relationship.relationshipKey,
      });
    }
  }

  return { issues };
}
