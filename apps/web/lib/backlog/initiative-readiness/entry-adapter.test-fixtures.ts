// Shared fixtures for the entry-adapter readiness tests.

export const item = {
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

export const transitionObject = {
  kind: "work-capsule" as const,
  id: "WC-PENDING",
  expectedVersion: "new",
  targetState: "working",
};

export const baseline = {
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

export function receipt(id: string, gateKey: string, decision: "pass" | "not-applicable" = "pass") {
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

export function readyActivities() {
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
