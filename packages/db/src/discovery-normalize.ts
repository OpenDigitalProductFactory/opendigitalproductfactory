import {
  buildDiscoveredKey,
  buildInventoryEntityKey,
} from "./discovery-identity";
import type {
  CollectorOutput,
  DiscoveredItemInput,
  DiscoveredRelationshipInput,
} from "./discovery-types";

export type NormalizedDiscoveredItem = {
  discoveredKey: string;
  sourceKind: string;
  itemType: string;
  name: string;
  externalRef: string;
  sourcePath?: string;
  confidence?: number;
  attributes: Record<string, unknown>;
};

export type NormalizedInventoryEntity = {
  entityKey: string;
  entityType: string;
  name: string;
  discoveredKey: string;
  portfolioSlug?: string;
  attributionStatus: "attributed" | "needs_review" | "unmapped" | "stale";
  providerView: "foundational";
  confidence?: number;
  properties: Record<string, unknown>;
};

export type NormalizedInventoryRelationship = {
  relationshipKey: string;
  relationshipType: string;
  fromDiscoveredKey?: string;
  toDiscoveredKey?: string;
  confidence?: number;
  properties: Record<string, unknown>;
};

export type NormalizedDiscoveryOutput = {
  discoveredItems: NormalizedDiscoveredItem[];
  inventoryEntities: NormalizedInventoryEntity[];
  inventoryRelationships: NormalizedInventoryRelationship[];
};

function mapEntityType(itemType: string): string {
  if (itemType === "host") return "host";
  if (itemType.endsWith("_runtime")) return "runtime";
  if (itemType.includes("container")) return "container";
  return itemType;
}

function isFoundationalInfrastructure(itemType: string): boolean {
  return itemType === "host"
    || itemType.endsWith("_runtime")
    || itemType.includes("database")
    || itemType.includes("network")
    || itemType.includes("storage");
}

function normalizeItem(item: DiscoveredItemInput): {
  discoveredItem: NormalizedDiscoveredItem;
  inventoryEntity: NormalizedInventoryEntity;
} {
  const sourceKind = item.sourceKind ?? "dpf_bootstrap";
  const externalRef = item.externalRef ?? item.naturalKey ?? item.name;
  const discoveredKey = buildDiscoveredKey({
    sourceKind,
    itemType: item.itemType,
    externalRef,
  });
  const entityType = mapEntityType(item.itemType);
  const entityKey = buildInventoryEntityKey({
    entityType,
    naturalKey: item.naturalKey ?? externalRef,
  });
  const foundational = isFoundationalInfrastructure(item.itemType);
  const attributionStatus = foundational ? "attributed" : "needs_review";
  const discoveredItem: NormalizedDiscoveredItem = {
    discoveredKey,
    sourceKind,
    itemType: item.itemType,
    name: item.name,
    externalRef,
    attributes: item.attributes ?? {},
  };

  if (item.sourcePath) {
    discoveredItem.sourcePath = item.sourcePath;
  }

  if (item.confidence != null) {
    discoveredItem.confidence = item.confidence;
  }

  const inventoryEntity: NormalizedInventoryEntity = {
    entityKey,
    entityType,
    name: item.name,
    discoveredKey,
    attributionStatus,
    providerView: "foundational",
    properties: item.attributes ?? {},
  };

  if (foundational) {
    inventoryEntity.portfolioSlug = "foundational";
  }

  if (item.confidence != null) {
    inventoryEntity.confidence = item.confidence;
  }

  return {
    discoveredItem,
    inventoryEntity,
  };
}

function normalizeRelationship(
  relationship: DiscoveredRelationshipInput,
  discoveredKeyByExternalRef: Map<string, string>,
): NormalizedInventoryRelationship {
  const normalizedRelationship: NormalizedInventoryRelationship = {
    relationshipKey: buildDiscoveredKey({
      sourceKind: relationship.sourceKind ?? "dpf_bootstrap",
      itemType: relationship.relationshipType,
      externalRef: `${relationship.fromExternalRef ?? "unknown"}->${relationship.toExternalRef ?? "unknown"}`,
    }),
    relationshipType: relationship.relationshipType,
    properties: relationship.attributes ?? {},
  };

  if (relationship.fromExternalRef) {
    normalizedRelationship.fromDiscoveredKey =
      discoveredKeyByExternalRef.get(relationship.fromExternalRef)
      ?? relationship.fromExternalRef;
  }

  if (relationship.toExternalRef) {
    normalizedRelationship.toDiscoveredKey =
      discoveredKeyByExternalRef.get(relationship.toExternalRef)
      ?? relationship.toExternalRef;
  }

  if (relationship.confidence != null) {
    normalizedRelationship.confidence = relationship.confidence;
  }

  return normalizedRelationship;
}

export function normalizeDiscoveredFacts(
  output: CollectorOutput,
): NormalizedDiscoveryOutput {
  const normalizedItems = output.items.map(normalizeItem);
  const discoveredKeyByExternalRef = new Map<string, string>();

  for (const entry of normalizedItems) {
    discoveredKeyByExternalRef.set(
      entry.discoveredItem.externalRef,
      entry.discoveredItem.discoveredKey,
    );
  }

  return {
    discoveredItems: normalizedItems.map((entry) => entry.discoveredItem),
    inventoryEntities: normalizedItems.map((entry) => entry.inventoryEntity),
    inventoryRelationships: output.relationships.map((relationship) =>
      normalizeRelationship(relationship, discoveredKeyByExternalRef),
    ),
  };
}
