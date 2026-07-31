// Data-governance registration for the stock coverage starter (BI-1323E39E,
// first slice of BI-SPEND-003). Supplies and recipe lines are the organization's
// own operating data: no data subject beyond the organization itself, so the
// subject locator is the organization and the projection stays local.

import type { DataAssetDefinition } from "./assets";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-07-31",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-07-31",
} as const;

export const STOCK_COVERAGE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:stock-item",
    physical: { prismaModel: "StockItem" },
    domain: "spend-procurement-assets",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["configuration", "operational"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    // Two fields carry more consequence than their type suggests: a wrong
    // number here produces a confidently wrong reorder proposal, so both are
    // governed rather than inherited.
    fields: [
      {
        id: "data:stock-item#onHandQuantity",
        physicalName: "onHandQuantity",
        resolution: "governed",
        resolutionReason:
          "Operator-maintained stocktake count, not a measured ledger; coverage projections are only as good as this number and must never be presented as measured.",
        provenance: PROVENANCE,
      },
      {
        id: "data:stock-item#reorderPoint",
        physicalName: "reorderPoint",
        resolution: "governed",
        resolutionReason:
          "The threshold that turns a stock level into a restocking proposal — an operator decision, never a platform default.",
        provenance: PROVENANCE,
      },
    ],
  },
  {
    id: "data:storefront-item-component",
    physical: { prismaModel: "StorefrontItemComponent" },
    domain: "spend-procurement-assets",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [{ role: "organization", fieldPath: "stockItem.organization" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      {
        id: "data:storefront-item-component#quantityPerUnit",
        physicalName: "quantityPerUnit",
        resolution: "governed",
        resolutionReason:
          "The multiplier turning units sold into derived consumption; an incorrect value silently scales every coverage projection built on it.",
        provenance: PROVENANCE,
      },
    ],
  },
];
