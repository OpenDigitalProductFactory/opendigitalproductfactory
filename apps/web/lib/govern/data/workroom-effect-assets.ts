// Data-governance registration for the Workroom runtime outbox (BI-C64EDA33,
// plan 2026-11-14-workroom-runtime-core). The live-schema coverage gate
// (coverage.live.test.ts) requires every Prisma model to be registered or
// baselined; registering it here resolves its fields at the model-level
// default. Data-impact manifest: docs/data-impact/2026-11-14-workroom-effect-outbox.data-impact.json.

import type { DataAssetDefinition } from "./asset-types";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-11-14",
} as const;

export const WORKROOM_EFFECT_ASSETS: readonly DataAssetDefinition[] = [
  {
    // One side effect a runtime decision emitted (start a turn, answer a
    // provider request, revoke a session credential), run by the leased effect
    // worker. Its payload is room work content (turn input, a request summary)
    // or a credential id, never a secret; it cascades with its room.
    id: "data:workroom-effect",
    physical: { prismaModel: "WorkroomEffect" },
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
