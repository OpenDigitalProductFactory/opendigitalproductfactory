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

function defineAssets(
  models: readonly (readonly [DataAssetId, string])[],
  options: {
    categories: DataCategory[];
    sensitivity: DataSensitivity;
    projectionClass: ProjectionClass;
  },
): DataAssetDefinition[] {
  return models.map(([id, prismaModel]) => ({
    id,
    physical: { prismaModel },
    domain: "business-product-portfolio",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: options.categories,
    sensitivity: options.sensitivity,
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
    projectionClass: options.projectionClass,
    classification: {
      state: "confirmed" as const,
      source: "manual" as const,
      effectiveFrom: "2026-07-28",
    },
    fields: [],
  }));
}

const PRODUCT_DIRECTION_MODELS = [
  ["data:business-product-objective", "ProductObjective"],
  ["data:business-product-objective-work", "ProductObjectiveWork"],
  [
    "data:business-product-outcome-observation",
    "ProductOutcomeObservation",
  ],
] as const;

export const BUSINESS_PRODUCT_PORTFOLIO_ASSETS: readonly DataAssetDefinition[] = [
  ...defineAssets(
    [
      ["data:business-product-line", "ProductLine"],
      ["data:business-product", "Product"],
      ["data:business-product-offering", "ProductOffering"],
      ["data:business-catalog-item", "CatalogItem"],
      ["data:business-product-configuration", "ProductConfiguration"],
      ["data:business-catalog-sku", "CatalogSku"],
      ["data:business-catalog-bundle-component", "CatalogBundleComponent"],
      ["data:business-catalog-price-list", "CatalogPriceList"],
      ["data:business-catalog-price-list-entry", "CatalogPriceListEntry"],
      ["data:business-catalog-promotion", "CatalogPromotion"],
      ["data:business-catalog-promotion-item", "CatalogPromotionItem"],
      ["data:business-catalog-channel-eligibility", "CatalogChannelEligibility"],
    ],
    {
      categories: ["configuration", "operational"],
      sensitivity: "internal",
      projectionClass: "metadata",
    },
  ),
  ...defineAssets(
    [
      ["data:business-product-sold", "ProductSold"],
      [
        "data:business-product-sold-component-allocation",
        "ProductSoldComponentAllocation",
      ],
    ],
    {
      categories: ["operational", "financial"],
      sensitivity: "internal",
      projectionClass: "metadata",
    },
  ),
  ...defineAssets(
    [
      ["data:business-storefront-order-line", "StorefrontOrderLineItem"],
      ["data:business-product-sold-evidence", "ProductSoldEvidence"],
      ["data:business-product-sold-party", "ProductSoldParty"],
      ["data:business-product-sold-entitlement", "ProductSoldEntitlement"],
      [
        "data:business-product-fulfillment-instance",
        "ProductFulfillmentInstance",
      ],
    ],
    {
      categories: ["identity", "operational"],
      sensitivity: "confidential",
      projectionClass: "masked-content",
    },
  ),
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
