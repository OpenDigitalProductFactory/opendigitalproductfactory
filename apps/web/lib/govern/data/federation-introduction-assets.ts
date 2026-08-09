import type { DataAssetDefinition } from "./assets";
import type { DataCategory, DataFieldId } from "./taxonomy";

export const FEDERATION_INTRODUCTION_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:federation-introduction-candidate",
    physical: { prismaModel: "FederationIntroductionCandidate" },
    domain: "federated-demand",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration", "security-audit"],
    sensitivity: "confidential",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations", "security-and-fraud"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-08" },
    fields: [
      ...["installationId", "deviceId", "authorityUrl", "displayName"].map((physicalName) => ({
        id: `data:federation-introduction-candidate#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Minimum candidate coordinate learned from an authenticated introducer; visible only to platform operators until an independent SAS pairing succeeds.",
        categories: ["configuration", "security-audit"] as DataCategory[],
        sensitivity: "confidential" as const,
        collectionRule: "minimize" as const,
        protection: "mask-on-read" as const,
        projectionOverride: "masked-content" as const,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-08-08",
        },
      })),
      {
        id: "data:federation-introduction-candidate#relationshipHint",
        physicalName: "relationshipHint",
        resolution: "governed",
        resolutionReason:
          "A policy-bounded pairing suggestion, never transferred trust or relationship authority.",
        categories: ["configuration"],
        sensitivity: "internal",
        collectionRule: "minimize",
        projectionOverride: "metadata",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-08-08",
        },
      },
    ],
  },
];
