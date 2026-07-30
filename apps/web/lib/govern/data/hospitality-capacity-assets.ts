import type { DataAssetDefinition } from "./assets";
import type {
  DataAssetId,
  DataCategory,
  ProjectionClass,
} from "./taxonomy";

function defineHospitalityAssets(
  models: readonly (readonly [DataAssetId, string])[],
  categories: DataCategory[],
  projectionClass: ProjectionClass,
): DataAssetDefinition[] {
  return models.map(([id, prismaModel]) => ({
    id,
    physical: { prismaModel },
    domain: "food-hospitality-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories,
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [
      { role: "organization", fieldPath: "organization" },
    ],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass,
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-07-30",
    },
    // Model registration is the inherited resolution for ordinary fields.
    // Explicit field overrides belong here only when a later policy needs
    // stricter projection, retention, or protection than the asset default.
    fields: [],
  }));
}

export const HOSPITALITY_CAPACITY_ASSETS: readonly DataAssetDefinition[] = [
  ...defineHospitalityAssets(
    [
      ["data:hospitality-resource", "HospitalityResource"],
      [
        "data:hospitality-resource-availability",
        "HospitalityResourceAvailability",
      ],
      ["data:hospitality-capacity-pool", "HospitalityCapacityPool"],
    ],
    ["configuration", "operational"],
    "structure",
  ),
  ...defineHospitalityAssets(
    [
      [
        "data:hospitality-capacity-allocation",
        "HospitalityCapacityAllocation",
      ],
    ],
    ["operational"],
    "metadata",
  ),
];
