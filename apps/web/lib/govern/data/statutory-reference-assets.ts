// apps/web/lib/govern/data/statutory-reference-assets.ts
//
// Statutory reference-data assets, extracted from assets.ts to keep that
// registry under its module-size ceiling (same pattern as the other
// *-assets.ts sibling modules). Spread into DATA_ASSET_REGISTRY.

import type { DataAssetDefinition } from "./assets";
import type { DataCategory, DataFieldId, DataSensitivity, ProtectionProfileKey } from "./taxonomy";

const PROVENANCE = {
  source: "manual" as const,
  state: "confirmed" as const,
  assertedBy: "data-steward",
  effectiveFrom: "2026-09-06",
};

export const STATUTORY_REFERENCE_ASSETS: readonly DataAssetDefinition[] = [
  {
    // BI-8E1FD1BD. Statutory payroll tax figures with their citation and a
    // proposed -> ratified lifecycle. The FIGURES are published by tax
    // authorities and are public facts; the RECORD is not, because it also says
    // which coworker proposed a reading and which human in this organization
    // ratified it. That attribution is the audit trail behind a filing, so the
    // asset is classified on the record rather than on the figure.
    id: "data:payroll-tax-rule",
    physical: { prismaModel: "PayrollTaxRule" },
    domain: "business-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "configuration", "authorization"],
    sensitivity: "internal",
    // A wrong figure here produces a wrong filing to a tax authority. There is
    // no higher-consequence reference data in the platform.
    criticality: "high",
    subjectLocators: [],
    // Tax records: deletion maxima are constrained by statute, not by us.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal", "billing-and-payments", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-09-06" },
    fields: [
      // The statutory figure and the jurisdiction/period that scope it. Public
      // facts an authority publishes; nothing here points at a person.
      ...([
        "id", "payrollTaxRuleId", "jurisdictionRefId", "taxType", "ruleKind",
        "side", "taxYear", "value", "currency", "qualifiers",
        "effectiveFrom", "effectiveTo", "status",
      ] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Published statutory reference data: a figure an authority publishes, and the jurisdiction, period and lifecycle state that scope it. No subject.",
        categories: ["financial", "configuration"] as DataCategory[],
        sensitivity: "public" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: PROVENANCE,
      })),
      // The citation. Kept public deliberately: a figure that cannot be shown to
      // come from the authority's own publication must not be usable, so the
      // evidence has to travel with the figure rather than be masked away from it.
      ...(["sourceUrl", "sourceExcerpt", "retrievedAt"] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "The authority's own publication and the quoted passage a ratifier checked. Public by design: an uncitable figure must never price money.",
        categories: ["financial", "configuration"] as DataCategory[],
        sensitivity: "public" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: PROVENANCE,
      })),
      // Attribution. This is the part that makes the record internal: who
      // proposed a reading, and which human accepted it. Identity, not finance.
      ...([
        "proposedByAgentId", "proposedAt", "ratifiedByUserId", "ratifiedAt",
        "rejectedReason", "notes",
      ] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Ratification trail: which coworker proposed the figure and which human accepted it. The audit answer to who stands behind a filing.",
        categories: ["identity", "authorization"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: PROVENANCE,
      })),
      // Row bookkeeping, no subject meaning.
      ...(["lifecycle", "lifecycleAt", "lifecycleReason", "createdAt", "updatedAt"] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason: "Record lifecycle and timestamps. Framework bookkeeping with no subject meaning.",
        categories: ["system-internal"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: PROVENANCE,
      })),
    ],
  },
];
