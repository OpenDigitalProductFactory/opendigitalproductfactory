// Data-governance registration for the retained S5 rehearsal requester
// enrollment record (BI-9F7192F9, design
// docs/superpowers/specs/2026-11-26-s5-rehearsal-requester-enrollment-design.md).
// The live-schema coverage gate (coverage.live.test.ts) requires every Prisma
// model to be registered or baselined; registering it here resolves its
// fields at the model-level default. Data-impact manifest:
// docs/data-impact/2026-11-26-s5-rehearsal-requester-enrollment.data-impact.json.

import type { DataAssetDefinition } from "./asset-types";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-11-26",
} as const;

export const S5_REHEARSAL_REQUESTER_ASSETS: readonly DataAssetDefinition[] = [
  {
    // One owner-enrolled synthetic requester for one S5 rehearsal setup: the
    // single durable marker that a User/Principal pair is a governed,
    // never-active rehearsal identity. Evidence references only (setup digest,
    // ruling, reservation, attempt, fixture, installation, lease and DB
    // identity refs) and the enroller/retirer Principals; never a password,
    // hash, token or session. Facts are immutable, rows cannot be deleted, and
    // the only transition is active -> retired. Retained per installation and
    // database; not portable across a clone or reset.
    id: "data:s5-rehearsal-requester-enrollment",
    physical: { prismaModel: "S5RehearsalRequesterEnrollment" },
    domain: "core-identity",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit", "identity"],
    sensitivity: "restricted",
    criticality: "high",
    // The subject is a synthetic rehearsal account, not a person; the linked
    // User and Principal are governed on their own records.
    subjectLocators: [],
    lifecycleClass: "business-record",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [],
  },
];
