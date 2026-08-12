import type { DataAssetDefinition } from "./assets";

/** Aggregated owner/manager analytics; source records remain in their domains. */
export const BUSINESS_PERFORMANCE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:business-metric-rollup",
    physical: { prismaModel: "BusinessMetricRollup" },
    domain: "business-performance",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["derived-analytic", "operational", "financial"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: "business-record",
    purposeCapabilities: ["product-analytics", "service-delivery"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-08-01",
    },
    fields: [],
  },
];
