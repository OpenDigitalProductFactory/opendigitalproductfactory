// Data-governance registration for the stock coverage starter (BI-1323E39E,
// first slice of BI-SPEND-003). Supplies and recipe lines are the organization's
// own operating data: no data subject beyond the organization itself, so the
// subject locator is the organization and the projection stays local.

import type { DataAssetDefinition } from "./assets";

const SHARED = {
  domain: "spend-procurement-assets",
  ownerRole: "business-operator",
  stewardRole: "data-steward",
  sensitivity: "internal",
  criticality: "medium",
  subjectLocators: [{ role: "organization", fieldPath: "organization" }],
  lifecycleClass: "operational",
  purposeCapabilities: ["service-delivery", "platform-operations"],
  residencyClass: "local-only",
  classification: {
    state: "confirmed",
    source: "manual",
    effectiveFrom: "2026-07-31",
  },
} as const;

export const STOCK_COVERAGE_ASSETS: readonly DataAssetDefinition[] = [
  {
    ...SHARED,
    id: "data:stock-item",
    physical: { prismaModel: "StockItem" },
    categories: ["configuration", "operational"],
    projectionClass: "structure",
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
        provenance: "manual",
      },
      {
        id: "data:stock-item#reorderPoint",
        physicalName: "reorderPoint",
        resolution: "governed",
        resolutionReason:
          "The threshold that turns a stock level into a restocking proposal — an operator decision, never a platform default.",
        provenance: "manual",
      },
    ],
  },
  {
    ...SHARED,
    id: "data:storefront-item-component",
    physical: { prismaModel: "StorefrontItemComponent" },
    categories: ["configuration"],
    projectionClass: "structure",
    fields: [
      {
        id: "data:storefront-item-component#quantityPerUnit",
        physicalName: "quantityPerUnit",
        resolution: "governed",
        resolutionReason:
          "The multiplier turning units sold into derived consumption; an incorrect value silently scales every coverage projection built on it.",
        provenance: "manual",
      },
    ],
  },
];
