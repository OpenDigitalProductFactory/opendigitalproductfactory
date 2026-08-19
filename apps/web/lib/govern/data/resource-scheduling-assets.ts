// W19 unified resource-scheduling family (BI-99C76A90, architecture pass
// 2026-08-16 §3.2-c) — data-governance registration for the four unified
// models. Classification mirrors the clone families it replaces
// (HOSPITALITY_CAPACITY_ASSETS / BEAUTY_CAPACITY_ASSETS): the rows describe
// operating fixtures, capacity pools, time windows, and an append-preserving
// allocation ledger; person-adjacent data stays in the referenced identity
// homes (ServiceProvider, StorefrontBooking) under their own assets.
import type { DataAssetDefinition } from "./assets";
import type { DataAssetId, DataCategory, ProjectionClass } from "./taxonomy";

function defineResourceSchedulingAssets(
  models: readonly (readonly [DataAssetId, string])[],
  categories: DataCategory[],
  projectionClass: ProjectionClass,
): DataAssetDefinition[] {
  return models.map(([id, prismaModel]) => ({
    id,
    physical: { prismaModel },
    domain: "resource-scheduling",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories,
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass,
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-08-18",
    },
    // Model registration is the inherited resolution for ordinary fields.
    fields: [],
  }));
}

export const RESOURCE_SCHEDULING_ASSETS: readonly DataAssetDefinition[] = [
  ...defineResourceSchedulingAssets(
    [
      ["data:resource", "Resource"],
      ["data:resource-availability", "ResourceAvailability"],
      ["data:resource-capacity-pool", "ResourceCapacityPool"],
    ],
    ["configuration", "operational"],
    "structure",
  ),
  ...defineResourceSchedulingAssets(
    [["data:resource-capacity-allocation", "ResourceCapacityAllocation"]],
    ["operational"],
    "structure",
  ),
];
