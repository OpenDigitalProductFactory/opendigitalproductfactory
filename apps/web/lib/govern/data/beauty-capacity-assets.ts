import type { DataAssetDefinition } from "./assets";
import type {
  DataAssetId,
  DataSensitivity,
  ProjectionClass,
} from "./taxonomy";

function defineBeautyAsset(input: {
  id: DataAssetId;
  prismaModel: string;
  sensitivity: DataSensitivity;
  projectionClass: ProjectionClass;
  organizationPath: string;
}): DataAssetDefinition {
  return {
    id: input.id,
    physical: { prismaModel: input.prismaModel },
    domain: "beauty-personal-care-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["configuration", "operational"],
    sensitivity: input.sensitivity,
    criticality: "high",
    subjectLocators: [
      { role: "organization", fieldPath: input.organizationPath },
    ],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: input.projectionClass,
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-08-01",
    },
    // Ordinary fields inherit this asset classification. Narrower field-level
    // projection policy can be added without weakening full-model coverage.
    fields: [],
  };
}

export const BEAUTY_CAPACITY_ASSETS: readonly DataAssetDefinition[] = [
  defineBeautyAsset({
    id: "data:beauty-resource",
    prismaModel: "BeautyResource",
    sensitivity: "internal",
    projectionClass: "structure",
    organizationPath: "organization",
  }),
  defineBeautyAsset({
    id: "data:beauty-resource-service",
    prismaModel: "BeautyResourceService",
    sensitivity: "internal",
    projectionClass: "structure",
    organizationPath: "storefront.organization",
  }),
  defineBeautyAsset({
    id: "data:beauty-resource-availability",
    prismaModel: "BeautyResourceAvailability",
    sensitivity: "internal",
    projectionClass: "structure",
    organizationPath: "organization",
  }),
  defineBeautyAsset({
    id: "data:beauty-capacity-allocation",
    prismaModel: "BeautyCapacityAllocation",
    sensitivity: "confidential",
    projectionClass: "metadata",
    organizationPath: "organization",
  }),
];
