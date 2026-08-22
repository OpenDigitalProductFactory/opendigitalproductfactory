import { describe, expect, it } from "vitest";

import { projectBacklogItemReadiness } from "./entry-adapter";

const item = {
  id: "row-1",
  itemId: "BI-ENTRY",
  type: "portfolio",
  source: "user-request",
  workType: "feature",
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  activeBuildKind: null,
};

const transitionObject = {
  kind: "work-capsule" as const,
  id: "WC-PENDING",
  expectedVersion: "new",
  targetState: "working",
};

describe("projectBacklogItemReadiness", () => {
  it("allows governed design work before a canonical design exists", () => {
    const projection = projectBacklogItemReadiness({
      item,
      activities: [],
      target: "design",
      transitionObject,
      authorization: "pass",
      capsuleIdentity: "pass",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(projection.governed).toBe(true);
    expect(projection.decision).toMatchObject({ verdict: "allowed", profile: "cross-domain" });
  });

  it("fails closed for an implementation claim with only textual spec and plan hints", () => {
    const projection = projectBacklogItemReadiness({
      item,
      activities: [],
      target: "implementation",
      transitionObject,
      authorization: "pass",
      capsuleIdentity: "pass",
      artifactHints: { hasSpec: true, hasPlan: true },
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(projection.decision.verdict).toBe("input-required");
    expect(projection.decision.unmet.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "CANONICAL_DESIGN_REQUIRED",
      "SPEC_APPROVAL_REQUIRED",
      "PLAN_REVIEW_REQUIRED",
      "PLAN_COVERAGE_REQUIRED",
    ]));
  });

  it("projects current typed evidence and one valid baseline into an allowed plan transition", () => {
    const baseline = {
      schemaVersion: 1,
      baselineId: "baseline-1",
      subject: { kind: "backlog-item", id: "BI-ENTRY" },
      profile: "cross-domain",
      artifactDigest: "sha256:design",
      supersedesBaselineId: null,
      objectiveStatements: [{ objectiveId: "OBJ-1" }],
      acceptanceStatements: [{ acceptanceId: "AC-1" }],
      approvalReceiptId: "r-approval",
      authoritySnapshot: { decision: "allow" },
    };
    const receipt = (id: string, gateKey: string, decision: "pass" | "not-applicable" = "pass") => ({
      id,
      kind: "initiative_gate_receipt",
      gateKey,
      recordedAt: new Date("2026-08-22T00:00:00.000Z"),
      payload: {
        schemaVersion: 1,
        receiptId: id,
        policyVersion: "initiative-readiness.v1",
        gate: gateKey,
        decision,
        subject: { kind: "backlog-item", id: "BI-ENTRY" },
        artifactRef: { kind: "document-version", versionId: "version-1" },
        artifactDigest: "sha256:design",
        artifactAuthorRef: "PRN-AUTHOR",
        reviewerPrincipalId: "PRN-REVIEWER",
        reviewerAgentId: "AGT-REVIEWER",
        authorityDecisionId: "DI-1",
        authoritySnapshot: {
          decision: "allow",
          effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "initiative_review",
          tokenScope: "organization",
          organizationId: "ORG-1",
          actionKey: "review_initiative",
          policyVersion: "coworker-authority.v1",
        },
        reason: "Reviewed against the current canonical design.",
        findingRefs: [],
        resolvedFindingRefs: [],
      },
    });
    const activities = [
      { id: "baseline-row", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date(), payload: baseline },
      receipt("r-research", "research"),
      receipt("r-approval", "spec-approval"),
      receipt("r-architecture", "architecture-review"),
      receipt("r-data", "data-review", "not-applicable"),
      receipt("r-ux", "ux-fit-review", "not-applicable"),
      receipt("r-security", "security-review", "not-applicable"),
      receipt("r-compliance", "compliance-review", "not-applicable"),
      receipt("r-domain", "domain-review", "not-applicable"),
    ];

    const projection = projectBacklogItemReadiness({
      item,
      activities,
      target: "plan",
      transitionObject,
      authorization: "pass",
      capsuleIdentity: "pass",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(projection.decision.verdict).toBe("allowed");
    expect(projection.baselineId).toBe("baseline-1");
  });

  it("denies instead of falling back when the newest governance evidence is malformed", () => {
    const projection = projectBacklogItemReadiness({
      item,
      activities: [{
        id: "bad",
        kind: "initiative_gate_receipt",
        gateKey: "research",
        recordedAt: new Date(),
        payload: { schemaVersion: 99, decision: "pass" },
      }],
      target: "design",
      transitionObject,
      authorization: "pass",
      capsuleIdentity: "pass",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(projection.decision.verdict).toBe("denied");
    expect(projection.decision.blockers.map((entry) => entry.code)).toContain("READINESS_PROJECTION_FAILED");
  });

  it("denies evidence whose typed subject belongs to another initiative", () => {
    const projection = projectBacklogItemReadiness({
      item,
      activities: [{
        id: "foreign",
        kind: "initiative_gate_receipt",
        gateKey: "research",
        recordedAt: new Date(),
        payload: {
          schemaVersion: 1,
          receiptId: "foreign",
          policyVersion: "initiative-readiness.v1",
          gate: "research",
          decision: "pass",
          subject: { kind: "backlog-item", id: "BI-FOREIGN" },
          artifactRef: { kind: "document-version", versionId: "version-1" },
          artifactDigest: "sha256:foreign",
          artifactAuthorRef: "PRN-AUTHOR",
          reviewerPrincipalId: "PRN-REVIEWER",
          reviewerAgentId: "AGT-REVIEWER",
          authorityDecisionId: "DI-1",
          authoritySnapshot: { decision: "allow" },
          reason: "Foreign review.",
          findingRefs: [],
          resolvedFindingRefs: [],
        },
      }],
      target: "design",
      transitionObject,
      authorization: "pass",
      capsuleIdentity: "pass",
      evaluatedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(projection.decision.verdict).toBe("denied");
    expect(projection.decision.blockers.map((entry) => entry.code)).toContain("READINESS_PROJECTION_FAILED");
  });
});
