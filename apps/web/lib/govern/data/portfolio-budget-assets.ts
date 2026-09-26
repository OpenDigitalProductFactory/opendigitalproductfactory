// Portfolio budget data assets (EP-PORTFOLIO-BUDGET-WIP, BI-9EC60FE0 and
// BI-EF265C9A). A quarterly points budget per portfolio, set by a named person
// with a reason and kept as a version chain, and the reservations that funding
// approval takes against it. Both are business records about investment, with
// no personal data beyond the setting or approving user and agent references.

import type { DataAssetDefinition } from "./assets";

function portfolioBudgetAsset(id: `data:${string}`, prismaModel: string): DataAssetDefinition {
  return {
    id,
    physical: { prismaModel },
    domain: "business-product-portfolio",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["financial", "operational"],
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "business-record",
    purposeCapabilities: ["service-delivery", "product-analytics"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-09-25" },
    fields: [],
  };
}

export const PORTFOLIO_BUDGET_ASSETS: readonly DataAssetDefinition[] = [
  portfolioBudgetAsset("data:portfolio-budget-period", "PortfolioBudgetPeriod"),
  portfolioBudgetAsset("data:budget-reservation", "BudgetReservation"),
];
