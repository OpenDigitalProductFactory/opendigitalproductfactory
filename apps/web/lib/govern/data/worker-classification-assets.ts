// Data-governance registration for worker classification (BI-C61CEEA9).
//
// A classification is a human judgement about a worker's legal status, and it
// decides whether the organisation may direct them, whether withholding applies
// and whether they accrue entitlements. A wrong or unaccountable value is
// misclassification exposure for the employer and lost entitlements for the
// worker, so these are regulated records — confidential, local, and never
// auto-purged.
//
// Registered rather than added to the legacy coverage baseline: that baseline
// grandfathers models whose governance was never stated, with a remediation BI
// and a deadline. These models are new and their governance is known, so
// baselining them would be filing fresh debt against a ratchet built to retire it.

import type { DataAssetDefinition } from "./assets";
import type { DataCategory, DataFieldId } from "./taxonomy";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-26",
} as const;

const PROVENANCE = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-26",
} as const;

/** Operational metadata: timestamps, lifecycle state and typed joins. */
function operationalFields(assetId: string, physicalNames: readonly string[]) {
  return physicalNames.map((physicalName) => ({
    id: `${assetId}#${physicalName}` as DataFieldId,
    physicalName,
    resolution: "governed" as const,
    resolutionReason:
      "Operational record metadata — surrogate key, timestamps, lifecycle state or a typed join. Carries no fact about the worker beyond the row's own bookkeeping.",
    categories: ["operational"] as DataCategory[],
    sensitivity: "internal" as const,
    collectionRule: "allowed" as const,
    protection: "none" as const,
    provenance: PROVENANCE,
  }));
}

/**
 * Fields that carry the employment-law judgement itself, or narrative about it.
 *
 * Masked on read: a classification and its reasoning are readable by the worker,
 * their accountable manager chain and workforce administration, and by nobody
 * else through an incidental projection.
 */
function judgementFields(assetId: string, physicalNames: readonly string[]) {
  return physicalNames.map((physicalName) => ({
    id: `${assetId}#${physicalName}` as DataFieldId,
    physicalName,
    resolution: "governed" as const,
    resolutionReason:
      "Employment-law judgement about a named worker, or the reasoning and evidence behind it. Expose only through an authorized workforce projection with masking applied; never an input to automated scoring or selection.",
    categories: ["personal-attribute", "operational"] as DataCategory[],
    sensitivity: "confidential" as const,
    collectionRule: "minimize" as const,
    protection: "mask-on-read" as const,
    projectionOverride: "masked-content" as const,
    provenance: PROVENANCE,
  }));
}

/** The worker this row is about, and the human accountable for the judgement. */
function identityFields(assetId: string, physicalNames: readonly string[]) {
  return physicalNames.map((physicalName) => ({
    id: `${assetId}#${physicalName}` as DataFieldId,
    physicalName,
    resolution: "governed" as const,
    resolutionReason:
      "Points at a person — the worker the determination is about, or the human accountable for making it. Identity governance is inherited from the referenced party record; this is a typed join, not a second home for identity.",
    categories: ["identity"] as DataCategory[],
    sensitivity: "confidential" as const,
    collectionRule: "minimize" as const,
    protection: "mask-on-read" as const,
    provenance: PROVENANCE,
  }));
}

export const WORKER_CLASSIFICATION_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:worker-classification-determination",
    physical: { prismaModel: "WorkerClassificationDetermination" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: [
      "service-delivery",
      "compliance-and-legal",
    ],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [
      ...judgementFields("data:worker-classification-determination", [
        "classification",
        "evidence",
        "rationale",
        "lifecycleReason",
      ]),
      ...identityFields("data:worker-classification-determination", [
        "employeeProfileId",
        "determinedByUserId",
      ]),
      ...operationalFields("data:worker-classification-determination", [
        "id",
        "workerClassificationDeterminationId",
        "jurisdictionSlug",
        "determinedAt",
        "lifecycle",
        "lifecycleAt",
        "createdAt",
        "updatedAt",
      ]),
    ],
  },
  {
    id: "data:worker-engagement-term",
    physical: { prismaModel: "WorkerEngagementTerm" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: [
      "service-delivery",
      "compliance-and-legal",
    ],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [
      // The agreed dates are the engagement fact that reclassifies a contractor
      // as an employee when it drifts, so they sit with the judgement, not with
      // ordinary timestamps.
      ...judgementFields("data:worker-engagement-term", [
        "startsOn",
        "endsOn",
        "lifecycleReason",
      ]),
      ...identityFields("data:worker-engagement-term", ["employeeProfileId"]),
      ...operationalFields("data:worker-engagement-term", [
        "id",
        "workerEngagementTermId",
        "lifecycle",
        "lifecycleAt",
        "createdAt",
        "updatedAt",
      ]),
    ],
  },
];
