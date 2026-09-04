// apps/web/lib/govern/data/ai-provider-governance-assets.ts
//
// AI-provider-governance data assets, extracted from assets.ts to keep that
// registry under its module-size ceiling (same pattern as the other
// *-assets.ts sibling modules). Spread into DATA_ASSET_REGISTRY.

import type { DataAssetDefinition } from "./assets";

export const AI_PROVIDER_GOVERNANCE_ASSETS: DataAssetDefinition[] = [
  {
    id: "data:ai-provider-connection",
    physical: { prismaModel: "AiProviderConnection" },
    domain: "ai-provider-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration", "authorization", "security-audit"],
    sensitivity: "confidential",
    criticality: "mission-critical",
    subjectLocators: [
      { role: "organization", fieldPath: "organization" },
    ],
    lifecycleClass: "legal-evidence",
    purposeCapabilities: ["platform-operations", "compliance-and-legal", "coworker-assistance"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-19" },
    fields: [],
  },
  {
    // Break-glass informed-risk clearance override (BI-4512E7D2). An operator's
    // explicit, audited acceptance that a provider is NOT verified-safe for a data
    // sensitivity, yet may serve it. A security-decision audit record (RETAINED,
    // restricted) alongside the provider connection it governs.
    id: "data:provider-clearance-override",
    physical: { prismaModel: "ProviderClearanceOverride" },
    domain: "ai-provider-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit", "authorization", "configuration"],
    sensitivity: "restricted",
    criticality: "mission-critical",
    subjectLocators: [
      { role: "organization", fieldPath: "organization" },
    ],
    lifecycleClass: "legal-evidence",
    purposeCapabilities: ["platform-operations", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-09-01" },
    fields: [],
  },
];
