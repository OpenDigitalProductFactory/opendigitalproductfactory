import type { DataAssetDefinition } from "./assets";
import type {
  DataAssetId,
  DataCategory,
  DataCriticality,
  DataSensitivity,
  LifecycleClassKey,
  ProcessingPurposeKey,
  ProjectionClass,
  ResidencyClassKey,
} from "./taxonomy";

const PRODUCT_DIRECTION_MODELS = [
  ["data:business-product-objective", "ProductObjective"],
  ["data:business-product-objective-work", "ProductObjectiveWork"],
  [
    "data:business-product-outcome-observation",
    "ProductOutcomeObservation",
  ],
] as const;

export const BUSINESS_PRODUCT_PORTFOLIO_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:business-demand-evidence-link",
    physical: { prismaModel: "DemandEvidenceLink" },
    domain: "business-product-portfolio",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["operational", "content"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [
      { role: "organization", fieldPath: "backlogItem.organization" },
    ],
    lifecycleClass: "business-record",
    purposeCapabilities: ["service-delivery", "product-analytics"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-07-28",
    },
    fields: [],
  },
  ...PRODUCT_DIRECTION_MODELS.map(([id, prismaModel]) => ({
    id: id as DataAssetId,
    physical: { prismaModel },
    domain: "business-product-portfolio",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["operational", "derived-analytic"] as DataCategory[],
    sensitivity: "internal" as DataSensitivity,
    criticality: "high" as DataCriticality,
    subjectLocators: [
      { role: "organization" as const, fieldPath: "organization" },
    ],
    lifecycleClass: "business-record" as LifecycleClassKey,
    purposeCapabilities: [
      "service-delivery",
      "product-analytics",
    ] as ProcessingPurposeKey[],
    residencyClass: "local-only" as ResidencyClassKey,
    projectionClass: "metadata" as ProjectionClass,
    classification: {
      state: "confirmed" as const,
      source: "manual" as const,
      effectiveFrom: "2026-07-28",
    },
    fields: [],
  })),
];
