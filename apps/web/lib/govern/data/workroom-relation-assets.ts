// Data-governance registration for work-coordination relation rows (BI-662254C6).

import type { DataAssetDefinition } from "./assets";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-09-01",
} as const;

export const WORKROOM_RELATION_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:workroom-relation",
    physical: { prismaModel: "WorkroomRelation" },
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
