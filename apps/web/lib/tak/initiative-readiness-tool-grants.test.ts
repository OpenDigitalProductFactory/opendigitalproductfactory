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
    });

    expect(findMany).toHaveBeenCalledOnce();
    expect(recovery.escalations).toEqual([]);
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
        },
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
