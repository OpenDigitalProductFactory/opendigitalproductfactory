// apps/web/lib/govern/data/ai-provider-governance-assets.ts
//
// AI-provider-governance data assets, extracted from assets.ts to keep that
// registry under its module-size ceiling (same pattern as the other
// *-assets.ts sibling modules). Spread into DATA_ASSET_REGISTRY.

import type { DataAssetDefinition } from "./assets";

const ASYNC_TRANSITION_FIELD_PROVENANCE = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-09-04",
} as const;

export const AI_PROVIDER_GOVERNANCE_ASSETS: DataAssetDefinition[] = [
  {
    // Durable, ordered lifecycle history for one authorized async inference
    // operation. Checkpoints contain only the sanitized platform projection;
    // provider-controlled diagnostics and credentials are excluded before this
    // record is written or emitted through the transition outbox.
    id: "data:async-inference-operation-transition",
    physical: { prismaModel: "AsyncInferenceOperationTransition" },
    domain: "ai-provider-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational", "security-audit"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations", "coworker-assistance"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-09-04" },
    fields: [
      {
        id: "data:async-inference-operation-transition#id",
        physicalName: "id",
        resolution: "inherited",
        resolutionReason:
          "The transition identifier inherits the asset's confidential operational policy.",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#operationId",
        physicalName: "operationId",
        resolution: "inherited",
        resolutionReason:
          "The owning operation reference inherits the asset's confidential operational policy.",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#sequence",
        physicalName: "sequence",
        resolution: "inherited",
        resolutionReason:
          "The monotonic sequence is ordinary lifecycle metadata covered by the asset policy.",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#status",
        physicalName: "status",
        resolution: "inherited",
        resolutionReason:
          "The closed lifecycle status inherits the asset's operational classification.",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#checkpoint",
        physicalName: "checkpoint",
        resolution: "governed",
        resolutionReason:
          "The sanitized checkpoint can reveal execution context and is minimized before persistence and projection.",
        categories: ["operational", "security-audit"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "structure",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#occurredAt",
        physicalName: "occurredAt",
        resolution: "governed",
        resolutionReason:
          "The event timestamp is retained only with the owning operation lifecycle for ordered audit reconstruction.",
        categories: ["operational", "security-audit"],
        sensitivity: "internal",
        collectionRule: "allowed",
        projectionOverride: "structure",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#deliveryAttempts",
        physicalName: "deliveryAttempts",
        resolution: "governed",
        resolutionReason:
          "The delivery counter is bounded operational evidence used to reconcile the transition outbox.",
        categories: ["operational", "security-audit"],
        sensitivity: "internal",
        collectionRule: "allowed",
        projectionOverride: "structure",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#deliveredAt",
        physicalName: "deliveredAt",
        resolution: "governed",
        resolutionReason:
          "The delivery timestamp records outbox reconciliation without extending the owning operation's retention.",
        categories: ["operational", "security-audit"],
        sensitivity: "internal",
        collectionRule: "allowed",
        projectionOverride: "structure",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
      {
        id: "data:async-inference-operation-transition#operation",
        physicalName: "operation",
        resolution: "inherited",
        resolutionReason:
          "The Prisma relation inherits the same policy and lifecycle as its owning operation reference.",
        provenance: ASYNC_TRANSITION_FIELD_PROVENANCE,
      },
    ],
  },
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
