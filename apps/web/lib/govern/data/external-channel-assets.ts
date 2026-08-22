import type { DataAssetDefinition } from "./assets";

/** Compact external-channel identity and drift evidence; never content or credentials. */
export const EXTERNAL_CHANNEL_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:external-channel-projection",
    physical: { prismaModel: "ExternalChannelProjection" },
    domain: "external-channel",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational", "configuration", "security-audit"],
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-22" },
    fields: [],
  },
];
