import { describe, expect, it } from "vitest";

import {
  getWorkPatternBindingPresentation,
  listWorkPatternBindingsForAgent,
  parseWorkPatternAuthorityScope,
  type WorkPatternAuthorityScopeV1,
  type WorkPatternBindingReaderDb,
} from "./work-pattern-binding-reader";

const AUTHORITY_SCOPE: WorkPatternAuthorityScopeV1 = {
  schemaVersion: 1,
  activationLaneKey: "WPL-lane",
  bindingScopeKey: "WPS-binding",
  patternKey: "build-review",
  patternVersion: 2,
  activityKey: "build.implement",
  riskClass: "internal-reversible",
  installScopes: ["dpf_dogfood"],
  organizationIds: ["org-dogfood"],
  taskCorpusKeys: ["dpf-repository"],
  modelProfileIds: ["frontier-coding"],
  promotionPolicyKey: "governed-build-playbook-promotion",
  promotionPolicyVersion: 1,
  sourceExperimentTaskRunId: "TR-WPX-source",
  corroborationTaskRunIds: [],
  priorSafeBindingId: "AB-prior",
  evidenceFreshnessAt: "2026-07-26T12:00:00.000Z",
  evidenceOrigin: "customer-zero",
  scopeCeiling: "same-install",
  blockers: ["broader_scope_requires_portable_corpus_or_customer_corroboration"],
};

describe("parseWorkPatternAuthorityScope", () => {
  it("parses a complete scope-locked work-pattern binding", () => {
    expect(parseWorkPatternAuthorityScope(AUTHORITY_SCOPE)).toEqual(AUTHORITY_SCOPE);
  });

  it.each([
    { ...AUTHORITY_SCOPE, schemaVersion: 2 },
    { ...AUTHORITY_SCOPE, patternVersion: 0 },
    { ...AUTHORITY_SCOPE, installScopes: ["fleet"] },
    { ...AUTHORITY_SCOPE, sourceExperimentTaskRunId: "" },
    { ...AUTHORITY_SCOPE, modelProfileIds: [] },
  ])("fails closed for malformed or widened authority scope", (scope) => {
    expect(parseWorkPatternAuthorityScope(scope)).toBeNull();
  });
});

describe("listWorkPatternBindingsForAgent", () => {
  it("returns only rows with a valid typed work-pattern scope", async () => {
    const db: WorkPatternBindingReaderDb = {
      listBindings: async () => [
        {
          bindingId: "AB-valid",
          name: "Build review v2",
          status: "active",
          resourceRef: "build-review@2",
          authorityScope: AUTHORITY_SCOPE,
          updatedAt: new Date("2026-07-26T12:00:00.000Z"),
        },
        {
          bindingId: "AB-invalid",
          name: "Broken",
          status: "active",
          resourceRef: "broken@1",
          authorityScope: { schemaVersion: 1 },
          updatedAt: new Date("2026-07-26T12:00:00.000Z"),
        },
      ],
    };

    await expect(
      listWorkPatternBindingsForAgent("build-specialist", { db }),
    ).resolves.toEqual([
      expect.objectContaining({
        bindingId: "AB-valid",
        authorityScope: AUTHORITY_SCOPE,
      }),
    ]);
  });
});

describe("getWorkPatternBindingPresentation", () => {
  it("keeps raw identifiers out of default-altitude scope and blocker copy", () => {
    const presentation = getWorkPatternBindingPresentation({
      bindingId: "AB-valid",
      name: "Build review v2",
      status: "active",
      resourceRef: "build-review@2",
      authorityScope: AUTHORITY_SCOPE,
      updatedAt: new Date("2026-07-26T12:00:00.000Z"),
    }, new Date("2026-07-27T12:00:00.000Z"));

    expect(presentation).toEqual({
      stateLabel: "Active method",
      scopeLabel: "Only this DPF installation",
      evidenceLabel: "Proven on DPF's own work",
      freshnessLabel: "Evidence checked 1 day ago",
      blockerMessages: [
        "Broader use needs a verified replay corpus or corroborating customer evidence.",
      ],
    });
    expect(JSON.stringify(presentation)).not.toContain("AB-valid");
    expect(JSON.stringify(presentation)).not.toContain("TR-WPX-source");
    expect(JSON.stringify(presentation)).not.toContain("WPS-binding");
  });
});
