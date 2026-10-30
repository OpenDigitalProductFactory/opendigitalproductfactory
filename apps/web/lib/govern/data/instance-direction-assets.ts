// Data-governance registration for the instance's direction (BI-916216E7):
// the owner's top-level outcomes and the version history of mission, vision
// and outcomes. Spec docs/superpowers/specs/2026-10-28-instance-direction-design.md.

import type { DataAssetDefinition } from "./asset-types";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-10-28",
} as const;

const SHARED: Omit<DataAssetDefinition, "id" | "physical"> = {
  domain: "decision-governance",
  ownerRole: "founder-business-owner",
  stewardRole: "data-steward",
  categories: ["configuration", "operational"],
  sensitivity: "internal",
  criticality: "high",
  subjectLocators: [{ role: "organization", fieldPath: "organization" }],
  lifecycleClass: "business-record",
  purposeCapabilities: ["platform-operations"],
  residencyClass: "local-only",
  projectionClass: "structure",
  classification: CLASSIFICATION,
  fields: [],
};

export const INSTANCE_DIRECTION_ASSETS: readonly DataAssetDefinition[] = [
  { id: "data:instance-outcome", physical: { prismaModel: "InstanceOutcome" }, ...SHARED },
  { id: "data:instance-direction-revision", physical: { prismaModel: "InstanceDirectionRevision" }, ...SHARED },
];
