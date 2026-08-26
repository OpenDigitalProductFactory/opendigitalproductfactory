import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";

import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-RECOVERY",
  policyVersion: "initiative-readiness.v2",
  subject: { kind: "backlog-item", id: "BI-A45D744A" },
  transitionObject: {
    kind: "work-capsule",
    id: "WC-04941646",
    expectedVersion: "claim.v1",
    targetState: "implementation",
  },
  profile: "fix",
  target: "implementation",
  verdict: "input-required",
  satisfied: [],
  unmet: [
    { code: "RESEARCH_REQUIRED", state: "missing", accountableRole: "design-author", evidenceRefs: [] },
    { code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner", evidenceRefs: [] },
  ],
  blockers: [],
  evaluatedAt: "2026-08-24T17:00:00.000Z",
};

const dispatchContext = {
  workroomId: "WC-04941646",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branchName: "fix/wordpress-operator-regressions-recovery",
  headSha: "21103703757a342c828dd6ef1bb9acc97a4b01f8",
};

const canonicalArtifact = {
  ok: true as const,
  path: "docs/superpowers/specs/2026-08-24-wordpress-operator-regressions-design.md",
  providerBlobId: "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e",
};

function grantRow(grantKey: string, agentId: string, displayName: string) {
  return {
    grantKey,
    agent: {
      agentId,
      displayName,
      status: "active",
      archived: false,
      lifecycleStage: "production",
    },
  };
}

describe("initiative readiness recovery routing", () => {
  it("returns deterministic executable packets for research and plan coverage without dispatching", async () => {
    const findMany = vi.fn().mockResolvedValue([
      grantRow("initiative_evidence_write", "AGT-WS-PORTFOLIO", "Portfolio Management"),
      grantRow("backlog_write", "AGT-WS-PORTFOLIO", "Portfolio Management"),
      grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
    ]);

    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: null,
    });

    expect(findMany).toHaveBeenCalledOnce();
    expect(recovery.escalations).toEqual([]);
    expect(recovery.unroutable).toEqual([]);
    expect(recovery.reviewerRoutes).toMatchObject([
      {
        accountableRole: "design-author",
        toolName: "record_initiative_evidence",
        grant: "initiative_evidence_write",
        gate: "research",
        targetAgentId: "AGT-WS-BUILD",
        requestCoworker: {
          targetAgent: "AGT-WS-BUILD",
          requestKey: `initiative-readiness:BI-A45D744A:research:${dispatchContext.headSha}`,
          tier: 2,
          enteredVia: "handoff",
          requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
          initiativeReviewBinding: {
            writerToolName: "record_initiative_evidence",
            itemId: "BI-A45D744A",
            gate: "research",
            expectedCurrentBaselineId: null,
            artifactRef: {
              kind: "repo-blob-at-commit",
              repositoryFullName: dispatchContext.repositoryFullName,
              commitSha: dispatchContext.headSha,
              path: canonicalArtifact.path,
              providerBlobId: canonicalArtifact.providerBlobId,
            },
          },
        },
      },
      {
        accountableRole: "implementation-planner",
        toolName: "record_plan_backlog_coverage",
        grant: "backlog_write",
        gate: "dependency-disposition",
        targetAgentId: "AGT-WS-BUILD",
        requestCoworker: {
          targetAgent: "AGT-WS-BUILD",
          requestKey: `initiative-readiness:BI-A45D744A:dependency-disposition:${dispatchContext.headSha}`,
          tier: 2,
          enteredVia: "handoff",
          requiredToolNames: ["record_plan_backlog_coverage", "read_source_at_version"],
          initiativeReviewBinding: {
            writerToolName: "record_plan_backlog_coverage",
            gate: "dependency-disposition",
          },
        },
      },
    ]);
  });

  it("carries the current baseline id into the binding so a superseded design cannot be reviewed", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: "IBL-7C41",
    });

    expect(recovery.reviewerRoutes[0]?.requestCoworker.initiativeReviewBinding.expectedCurrentBaselineId)
      .toBe("IBL-7C41");
  });

  it("escalates with the provider remedy instead of emitting a route no coworker can execute", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact: { ok: false, nextAction: "Commit the canonical design under docs/superpowers/specs/, push it, then retry." },
    });

    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations).toMatchObject([
      {
        accountableRole: "design-author",
        reason: "no-canonical-artifact",
        nextAction: "Commit the canonical design under docs/superpowers/specs/, push it, then retry.",
      },
      { accountableRole: "implementation-planner", reason: "no-canonical-artifact" },
    ]);
  });

  it("surfaces an unmet requirement whose accountable role owns no writer lane", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: {
        ...decision,
        unmet: [
          { code: "ARTIFACT_AUTHOR_REQUIRED", state: "missing", accountableRole: "artifact-resolver", evidenceRefs: [] },
        ],
      },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([]) } },
      dispatchContext,
      canonicalArtifact,
    });

    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations).toEqual([]);
    expect(recovery.unroutable).toMatchObject([
      {
        accountableRole: "artifact-resolver",
        code: "ARTIFACT_AUTHOR_REQUIRED",
        nextAction: expect.stringContaining("git commit -s"),
      },
    ]);
  });

  it("returns both exact next-action mappings when immutable dispatch identity is unavailable", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext: null,
      canonicalArtifact,
    });

    expect(recovery.reviewerRoutes).toEqual([]);
    // The reason must NOT be "no-eligible-reviewer" here: both grants above are
    // held by an active production agent. Reporting an absent roster when the
    // roster is fine sends the caller hunting for missing grants instead of
    // supplying the dispatch context, which is the one thing actually missing.
    expect(recovery.escalations).toMatchObject([
      {
        accountableRole: "design-author",
        toolName: "record_initiative_evidence",
        grant: "initiative_evidence_write",
        reason: "dispatch-context-required",
      },
      {
        accountableRole: "implementation-planner",
        toolName: "record_plan_backlog_coverage",
        grant: "backlog_write",
        reason: "dispatch-context-required",
      },
    ]);
    // and it must name the reviewer it found, so the caller can see the roster is healthy
    expect(recovery.escalations[0]!.nextAction).toContain("AGT-WS-BUILD");
  });

  it("reports no-eligible-reviewer ONLY when nobody holds the grant", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      // Empty roster: no agent holds either grant in a production, active state.
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([]) } },
      dispatchContext,
    });

    expect(recovery.reviewerRoutes).toEqual([]);
    for (const escalation of recovery.escalations) {
      expect(escalation.reason).toBe("no-eligible-reviewer");
      expect(escalation.nextAction).toContain("Assign or activate");
    }
    expect(recovery.escalations.length).toBeGreaterThan(0);
  });

  it("keeps the two blocked states distinguishable from each other", async () => {
    const roster = [
      grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
    ];
    const withoutDispatch = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(roster) } },
      dispatchContext: null,
    });
    const withoutRoster = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([]) } },
      dispatchContext,
    });

    const reasons = new Set([
      ...withoutDispatch.escalations.map((entry) => entry.reason),
      ...withoutRoster.escalations.map((entry) => entry.reason),
    ]);
    // Two genuinely different operator actions must not collapse to one code.
    expect(reasons).toEqual(new Set(["dispatch-context-required", "no-eligible-reviewer"]));
  });
});
