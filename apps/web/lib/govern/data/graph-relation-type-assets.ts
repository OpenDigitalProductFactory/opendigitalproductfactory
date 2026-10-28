// Data-governance registration for the graph relation vocabulary (BI-85389A35).

import type { DataAssetDefinition } from "./asset-types";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-10-28",
} as const;

export const GRAPH_RELATION_TYPE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:graph-relation-type",
    physical: { prismaModel: "GraphRelationType" },
    domain: "platform-operations",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "public",
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
