import { describe, expect, it } from "vitest";

import { projectBacklogItemReadiness, projectBacklogItemReadinessSummary } from "./entry-adapter";

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

function receipt(id: string, gateKey: string, decision: "pass" | "not-applicable" = "pass") {
  return {
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
  };
}

function readyActivities() {
  return [
    { id: "baseline-row", kind: "initiative_scope_baseline", gateKey: null, recordedAt: new Date(), payload: baseline },
    receipt("r-research", "research"),
    receipt("r-approval", "spec-approval"),
    receipt("r-architecture", "architecture-review"),
    receipt("r-data", "data-review", "not-applicable"),
    receipt("r-ux", "ux-fit-review", "not-applicable"),
    receipt("r-security", "security-review", "not-applicable"),
    receipt("r-compliance", "compliance-review", "not-applicable"),
    receipt("r-domain", "domain-review", "not-applicable"),
    receipt("r-plan-review", "plan-review"),
    receipt("r-dependencies", "dependency-disposition", "not-applicable"),
    {
      id: "coverage-1",
      kind: "plan_backlog_coverage",
      gateKey: null,
      recordedAt: new Date(),
      payload: {
        schemaVersion: 2,
        decision: "atomic",
        planPath: "docs/superpowers/plans/plan.md",
        planArtifactRef: { kind: "repo-blob-at-commit", path: "docs/superpowers/plans/plan.md" },
        planArtifactDigest: "sha256:plan",
        scopeBaselineId: "baseline-1",
        scopeBaselineArtifactDigest: "sha256:design",
        deliverables: [],
      },
    },
  ];
}

function terminalFixture(payloadOverride: Record<string, unknown> = {}) {
  const decision = projectBacklogItemReadiness({
    item,
    activities: readyActivities(),
    target: "completion",
    transitionObject: {
      kind: "work-capsule",
      id: "WC-COMPLETE",
      expectedVersion: "ready",
      targetState: "complete",
    },
    authorization: "pass",
    capsuleIdentity: "pass",
    completion: {
      deliveryEvidence: "pass",
      acceptanceEvidence: "pass",
      objectiveReconciliation: "pass",
    },
    evaluatedAt: "2026-08-22T08:00:00.000Z",
  }).decision;
  return {
    decision,
    activity: {
      id: "activity-terminal",
      kind: "initiative_readiness_decision",
      gateKey: null,
      recordedAt: new Date("2026-08-22T08:01:00.000Z"),
      payload: {
        schemaVersion: 1,
        ...decision,
        enforcementState: "enforced",
        factsDigest: "sha256:facts",
        authorityDecisionId: "DI-TERMINAL",
        authoritySnapshot: {
          decision: "allow",
          effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "update_work_capsule_status",
          tokenScope: "organization",
          organizationId: "platform",
          actionKey: "complete_work_capsule",
          policyVersion: "coworker-authority.v1",
        },
        ...payloadOverride,
      },
    },
  };
}

describe("projectBacklogItemReadiness", () => {
  it("preserves the enforced allowed completion decision for a done item", () => {
    const fixture = terminalFixture();
    const summary = projectBacklogItemReadinessSummary({
      item: { ...item, status: "done" },
      activities: [fixture.activity],
      hasSpec: true,
      hasPlan: true,
      evaluatedAt: "2026-08-23T00:00:00.000Z",
    });

    expect(summary.decisions.completion).toEqual(fixture.decision);
    expect(summary.decisions.completion.verdict).toBe("allowed");
  });

  it.each([
    ["wrong subject", { subject: { kind: "backlog-item", id: "BI-OTHER" } }],
    ["wrong target", { target: "implementation" }],
    ["wrong transition target", { transitionObject: { kind: "work-capsule", id: "WC-COMPLETE", expectedVersion: "ready", targetState: "working" } }],
    ["non-allowed verdict", { verdict: "input-required" }],
    ["unenforced payload", { enforcementState: "shadow" }],
    ["malformed payload", { decisionId: null }],
  ])("ignores a terminal decision with %s", (_label, override) => {
    const fixture = terminalFixture(override);
    const summary = projectBacklogItemReadinessSummary({
      item: { ...item, status: "done" },
      activities: [fixture.activity],
      hasSpec: true,
      hasPlan: true,
      evaluatedAt: "2026-08-23T00:00:00.000Z",
    });

    expect(summary.decisions.completion.verdict).toBe("input-required");
  });

  it("does not reuse a terminal completion decision for a nonterminal item", () => {
    const fixture = terminalFixture();
    const summary = projectBacklogItemReadinessSummary({
      item: { ...item, status: "in-progress" },
      activities: [fixture.activity],
      hasSpec: true,
      hasPlan: true,
      evaluatedAt: "2026-08-23T00:00:00.000Z",
    });

    expect(summary.decisions.completion.verdict).toBe("input-required");
  });

  it("allows completion only when terminal facts reconcile against live evidence", () => {
    const projected = projectBacklogItemReadiness({
      item,
      activities: readyActivities(),
      target: "completion",
      transitionObject: {
        kind: "backlog-item",
        id: "BI-ENTRY",
        expectedVersion: "in-progress",
        targetState: "done",
      },
      authorization: "pass",
      capsuleIdentity: "pass",
      completion: {
        deliveryEvidence: "pass",
        acceptanceEvidence: "pass",
        objectiveReconciliation: "pass",
        evidenceRefs: {
          DELIVERY_EVIDENCE_REQUIRED: ["E-TEST", "E-BUILD"],
          ACCEPTANCE_EVIDENCE_REQUIRED: ["E-ACCEPT"],
          OBJECTIVE_RECONCILIATION_REQUIRED: ["E-TEST", "E-ACCEPT"],
        },
      },
      evaluatedAt: "2026-08-22T08:00:00.000Z",
    });

    expect(projected.decision.verdict).toBe("allowed");
    expect(projected.decision.satisfied.find((entry) => entry.code === "OBJECTIVE_RECONCILIATION_REQUIRED")?.evidenceRefs)
      .toEqual(["E-TEST", "E-ACCEPT"]);
  });

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
    expect(projection.decision).toMatchObject({ verdict: "allowed", profile: "feature" });
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
    const activities = readyActivities().filter((entry) => entry.kind !== "plan_backlog_coverage"
      && entry.gateKey !== "plan-review" && entry.gateKey !== "dependency-disposition");

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
