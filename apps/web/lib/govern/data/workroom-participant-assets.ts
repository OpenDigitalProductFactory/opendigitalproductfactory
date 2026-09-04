// Data-governance registration for persisted Workroom roster rows (BI-4CB2EF76).
// The live-schema coverage gate requires every Prisma model to be registered or
// baselined. Fields resolve at the model-level default.

import type { DataAssetDefinition } from "./assets";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-09-01",
} as const;

export const WORKROOM_PARTICIPANT_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:workroom-participant",
    physical: { prismaModel: "WorkroomParticipant" },
    domain: "platform-operations",
    ownerRole: "platform-operator",
    stewardRole: "data-steward",
    categories: ["operational"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [],
  },
];
