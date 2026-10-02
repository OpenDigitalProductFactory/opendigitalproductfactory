// Data-governance registration for GPP shadow permits (GPP Phase 2 PR-C,
// BI-69415B68). The live-schema coverage gate (coverage.live.test.ts) requires
// every Prisma model to be registered or baselined; registering the models here
// resolves their fields at the model-level default (coverage.ts), matching the
// `@dpf lifecycle=telemetry-bounded retention=365d sensitivity=internal
// categories=security-audit` tags on the models themselves.
//
// Neither model holds a foreign key to a person. The acting user is carried as
// an opaque reference (`actorUserRef`), so there is no subject locator; the
// field is registered as governed audit metadata instead.

import type { DataAssetDefinition } from "./asset-types";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-10-01",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-10-01",
} as const;

export const GPP_PERMIT_ASSETS: readonly DataAssetDefinition[] = [
  {
    // A gate-minted permit for one outward, authority or irreversible call:
    // which gate admitted it, for which tools, until when. Shadow-only in
    // Phase 2; it never decides an outcome.
    id: "data:gpp-permit",
    physical: { prismaModel: "GppPermit" },
    domain: "platform-operations",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "telemetry-bounded",
    purposeCapabilities: ["platform-operations", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [
      {
        id: "data:gpp-permit#actorUserRef",
        physicalName: "actorUserRef",
        resolution: "governed",
        resolutionReason:
          "Opaque reference to the user on whose behalf the permitted call ran; audit metadata that answers who acted, not a profile of the person.",
        provenance: PROVENANCE,
      },
    ],
  },
  {
    // One permit verdict per outward, authority or irreversible call, recorded
    // by the monitor or by a direct call that bypassed it. Audit only.
    id: "data:gpp-permit-observation",
    physical: { prismaModel: "GppPermitObservation" },
    domain: "platform-operations",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "telemetry-bounded",
    purposeCapabilities: ["platform-operations", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: CLASSIFICATION,
    fields: [],
  },
];
