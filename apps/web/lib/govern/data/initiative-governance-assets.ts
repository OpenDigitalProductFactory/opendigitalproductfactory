import type { DataAssetDefinition } from "./assets";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-08",
};

/** Permanent, append-only evidence that binds an approved initiative baseline to immutable bytes. */
export const INITIATIVE_GOVERNANCE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:initiative-artifact-retention-pin",
    physical: { prismaModel: "InitiativeArtifactRetentionPin" },
    domain: "initiative-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit", "content"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "legal-evidence",
    purposeCapabilities: ["compliance-and-legal", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-08-08",
    },
    fields: [
      {
        id: "data:initiative-artifact-retention-pin#artifactLocator",
        physicalName: "artifactLocator",
        resolution: "governed",
        resolutionReason:
          "Immutable provider or managed-document locator retained for audit. It is minimized and masked because repository and document coordinates are internal evidence metadata.",
        categories: ["security-audit", "content"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        purposeCapabilities: ["compliance-and-legal", "platform-operations"],
        lifecycleOverride: "legal-evidence",
        projectionOverride: "masked-content",
        provenance: PROVENANCE,
      },
    ],
  },
];
