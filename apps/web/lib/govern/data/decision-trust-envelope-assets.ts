// Data-governance registration for the trust-envelope decision records
// (EP-VERIFICATION-INTEGRITY). Three new persistent models added by the trust
// envelope over the decision kernel — registered so the live coverage gate
// (coverage.live.test.ts) accounts for every field, and so their sensitivity /
// lifecycle / residency are governed rather than inherited by fallback.
//
// The monitoring-only rail is deliberately registered with NO subjectLocator:
// ProtectedMonitoringObservation holds no direct foreign key to the person it is
// about (it is joined to an evaluation only by an opaque evaluationRef), which is
// the structural guardrail that keeps demographic data off the scoring path.

import type { DataAssetDefinition } from "./assets";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-06",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-06",
} as const;

export const DECISION_TRUST_ENVELOPE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:jurisdiction-criteria-profile",
    physical: { prismaModel: "JurisdictionCriteriaProfile" },
    domain: "decision-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["compliance-and-legal", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      {
        id: "data:jurisdiction-criteria-profile#requiredAxes",
        physicalName: "requiredAxes",
        resolution: "governed",
        resolutionReason:
          "Operator-authored jurisdiction pack: selects which scoring axes must apply under a regime (e.g. NYC LL144). A wrong axis set produces a legally indefensible decision vector, so it is governed, never a platform default.",
        provenance: PROVENANCE,
      },
      {
        id: "data:jurisdiction-criteria-profile#weightOverlay",
        physicalName: "weightOverlay",
        resolution: "governed",
        resolutionReason:
          "Per-axis weight multiplier applied under the regime; a business/legal judgement that changes the outcome, recorded on the decision for auditability.",
        provenance: PROVENANCE,
      },
    ],
  },
  {
    id: "data:evidence-reverification",
    physical: { prismaModel: "EvidenceReVerification" },
    domain: "decision-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit", "derived-analytic"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "legal-evidence",
    purposeCapabilities: ["compliance-and-legal", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [
      {
        id: "data:evidence-reverification#verdict",
        physicalName: "verdict",
        resolution: "governed",
        resolutionReason:
          "Independent re-check verdict (confirmed | degraded | unresolved) of a cited evidence item against its live source; a degraded/unresolved verdict downgrades the decision, so the value is decision-governing audit evidence.",
        provenance: PROVENANCE,
      },
      {
        id: "data:evidence-reverification#recordedExcerpt",
        physicalName: "recordedExcerpt",
        resolution: "governed",
        resolutionReason:
          "The recorded excerpt the score relied on. May quote decision or candidate source text, so it is confidential content re-checked against the live source rather than inherited.",
        provenance: PROVENANCE,
      },
    ],
  },
  {
    id: "data:protected-monitoring-observation",
    physical: { prismaModel: "ProtectedMonitoringObservation" },
    domain: "decision-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "security-audit"],
    sensitivity: "confidential",
    criticality: "high",
    // Intentionally no subjectLocator: the rail holds no direct FK to the person
    // it describes — joined to an evaluation only by an opaque evaluationRef — so
    // demographic data can never be reached from the scoring path (spec §6.3.2).
    subjectLocators: [],
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [
      {
        id: "data:protected-monitoring-observation#protectedClass",
        physicalName: "protectedClass",
        resolution: "governed",
        resolutionReason:
          "Protected-class attribute collected (where lawful + consented) SOLELY to compute NYC LL144 / four-fifths adverse-impact ratios; the scoring path holds no read access. Governed personal-attribute data on a monitoring-only rail.",
        provenance: PROVENANCE,
      },
      {
        id: "data:protected-monitoring-observation#selectionOutcome",
        physicalName: "selectionOutcome",
        resolution: "governed",
        resolutionReason:
          "Post-decision label (advanced | rejected | hired) that pairs with protectedClass to compute the impact ratio; the numerator of the bias audit.",
        provenance: PROVENANCE,
      },
    ],
  },
  {
    // BI-D88DFEEA: aggregated evidence that an organization's recorded
    // decisions systematically separate from the kernel recommendation.
    id: "data:weight-adjustment-proposal",
    physical: { prismaModel: "WeightAdjustmentProposal" },
    domain: "decision-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["derived-analytic", "security-audit"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [{ role: "user", fieldPath: "ruledByUser" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-24" },
    fields: [],
  },
  {
    // BI-3D0FB84B: a drafted resolution an owner accepts, edits or rejects.
    // Holds the organization's own business judgement once accepted, plus the
    // ruling human's identity by reference — hence governed, local-only, and
    // never emitted to the hive or a federated peer.
    id: "data:decision-resolution-proposal",
    physical: { prismaModel: "DecisionResolutionProposal" },
    domain: "decision-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["content", "operational", "security-audit"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [{ role: "user", fieldPath: "ruledByUser" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-23" },
    fields: [],
  },
];
