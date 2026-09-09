// Mailroom data assets (design 2026-09-09 §4.3, BI-1DDFC3D1).
//
// `MailboxAccount` is where the business listens: an address, a provider, a
// purpose, a schedule and a cursor, plus the encrypted credential the poll uses.
// The mailroom columns on `InboundChannelMessage` are covered by that model's
// existing registration and its legacy baseline; this module registers only the
// new model.

import type { DataAssetDefinition } from "./assets";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-09-09",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-09-09",
} as const;

const ASSET_ID = "data:mailbox-account" as const;

function field(
  physicalName: string,
  input: {
    resolution: "governed" | "inherited";
    reason: string;
    categories: DataAssetDefinition["fields"][number]["categories"];
    sensitivity: "internal" | "confidential" | "restricted";
    projectionOverride?: DataAssetDefinition["fields"][number]["projectionOverride"];
  },
): DataAssetDefinition["fields"][number] {
  return {
    id: `${ASSET_ID}#${physicalName}` as `data:${string}#${string}`,
    physicalName,
    resolution: input.resolution,
    resolutionReason: input.reason,
    categories: input.categories,
    sensitivity: input.sensitivity,
    collectionRule: "minimize",
    ...(input.projectionOverride ? { projectionOverride: input.projectionOverride } : {}),
    provenance: PROVENANCE,
  };
}

export const MAILROOM_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: ASSET_ID,
    physical: { prismaModel: "MailboxAccount" },
    domain: "business-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["contact", "credential-secret", "operational"],
    sensitivity: "restricted",
    criticality: "high",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: "business-record",
    purposeCapabilities: ["service-delivery"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      field("address", {
        resolution: "governed",
        reason: "A business mailbox address the organisation declares; operator-visible on the Mailroom, never public and never placed in a model prompt.",
        categories: ["contact"],
        sensitivity: "confidential",
        projectionOverride: "masked-content",
      }),
      field("secretsEnc", {
        resolution: "governed",
        reason: "The IMAP password or Graph client secret, encrypted with credential-crypto; decrypted only for a probe or a fetch and never projected or copied.",
        categories: ["credential-secret"],
        sensitivity: "restricted",
        projectionOverride: "masked-content",
      }),
      field("settings", {
        resolution: "inherited",
        reason: "Non-secret connection facts (host, port, folder, tenant id, client id, mailbox principal name) the operator entered; operational configuration.",
        categories: ["operational"],
        sensitivity: "internal",
      }),
      field("cursor", {
        resolution: "inherited",
        reason: "Provider read position (IMAP UID validity and last UID, or a Graph delta link); bookkeeping with no content.",
        categories: ["operational"],
        sensitivity: "internal",
      }),
    ],
  },
];
