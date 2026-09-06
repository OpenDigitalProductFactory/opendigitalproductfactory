import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";

import { parseInitiativeReviewBinding } from "@/lib/mcp-task-submit";
import { validateObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

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
    readinessRequirement({ code: "RESEARCH_REQUIRED", state: "missing", accountableRole: "design-author" }),
    readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" }),
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
  resolved: true as const,
  path: "docs/superpowers/specs/2026-08-24-wordpress-operator-regressions-design.md",
  providerBlobId: "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e",
};

const eligibleEvidenceActivityIds = [
  "cmtnr924q-post-baseline",
  "cmtnr926e-post-baseline",
  "cmtnr927v-post-baseline",
  "cmtnr9295-post-baseline",
];

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
  it("routes acceptance reconciliation through an exact objective-mapping evidence packet", async () => {
    const acceptanceDecision: InitiativeReadinessDecision = {
      ...decision,
      target: "completion",
      verdict: "denied",
      unmet: [
        readinessRequirement({
          code: "OBJECTIVE_RECONCILIATION_REQUIRED",
          state: "missing",
          accountableRole: "acceptance-reviewer",
        }),
      ],
    };
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: acceptanceDecision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-ACCEPT", "Acceptance Reviewer"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: "baseline-current",
      eligibleEvidenceActivityIds,
    });

    expect(recovery.escalations).toEqual([]);
    expect(recovery.unroutable).toEqual([]);
    expect(recovery.reviewerRoutes).toMatchObject([{
      accountableRole: "acceptance-reviewer",
      toolName: "record_initiative_evidence",
      grant: "initiative_evidence_write",
      gate: "objective-mapping",
      targetAgentId: "AGT-WS-ACCEPT",
      requestCoworker: {
        requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
        initiativeReviewBinding: {
          writerToolName: "record_initiative_evidence",
          itemId: "BI-A45D744A",
          gate: "objective-mapping",
          expectedCurrentBaselineId: "baseline-current",
          eligibleEvidenceActivityIds,
        },
      },
    }]);
    expect(recovery.reviewerRoutes[0]?.requestCoworker.objective)
      .toContain("Map every current OBJ-* and AC-* statement to post-baseline evidence");
    expect(recovery.reviewerRoutes[0]?.requestCoworker.objective)
      .toContain(eligibleEvidenceActivityIds.join(", "));
    const packet = recovery.reviewerRoutes[0]!.requestCoworker;
    expect(packet.initiativeReviewBinding).toMatchObject({
      workroomRef: {
        kind: "workroom-head",
        workroomId: dispatchContext.workroomId,
        repositoryFullName: dispatchContext.repositoryFullName,
        branchName: dispatchContext.branchName,
        headSha: dispatchContext.headSha,
      },
    });
    expect(packet.requestKey).toMatch(/:packet-v2:[a-f0-9]{64}$/u);
    expect(validateObjectiveMappingRequestKey({
      targetAgent: packet.targetAgent,
      objective: packet.objective,
      questionPacketSummary: packet.questionPacketSummary,
      requiredToolNames: packet.requiredToolNames!,
      binding: packet.initiativeReviewBinding as Parameters<typeof validateObjectiveMappingRequestKey>[0]["binding"],
      requestKey: packet.requestKey,
    })).toBe(true);
  });

  it("fails closed instead of issuing an open-ended mapping packet when no eligible evidence exists", async () => {
    const acceptanceDecision: InitiativeReadinessDecision = {
      ...decision,
      target: "completion",
      verdict: "denied",
      unmet: [readinessRequirement({
        code: "OBJECTIVE_RECONCILIATION_REQUIRED",
        state: "missing",
        accountableRole: "acceptance-reviewer",
      })],
    };
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: acceptanceDecision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-ACCEPT", "Acceptance Reviewer"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: "baseline-current",
      eligibleEvidenceActivityIds: [],
    });

    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations).toMatchObject([{
      accountableRole: "acceptance-reviewer",
      reason: "no-eligible-evidence",
    }]);
  });

  it("sequences independent spec approval before plan coverage when no baseline exists", async () => {
    const findMany = vi.fn().mockResolvedValue([
      grantRow("initiative_evidence_write", "AGT-WS-PORTFOLIO", "Portfolio Management"),
      grantRow("backlog_write", "AGT-WS-PORTFOLIO", "Portfolio Management"),
      grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      grantRow("initiative_design_review", "AGT-WS-REVIEW", "Independent Reviewer"),
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
        accountableRole: "design-checklist-reviewer",
        toolName: "record_initiative_design_review",
        grant: "initiative_design_review",
        gate: "spec-approval",
        targetAgentId: "AGT-WS-REVIEW",
        requestCoworker: {
          targetAgent: "AGT-WS-REVIEW",
          requestKey: `initiative-readiness:BI-A45D744A:spec-approval:${dispatchContext.headSha}`,
          tier: 2,
          enteredVia: "handoff",
          requiredToolNames: ["record_initiative_design_review", "read_source_at_version"],
          initiativeReviewBinding: {
            writerToolName: "record_initiative_design_review",
            itemId: "BI-A45D744A",
            gate: "spec-approval",
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
    ]);
    expect(recovery.reviewerRoutes.map((route) => route.toolName))
      .not.toContain("record_plan_backlog_coverage");
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

    expect(recovery.reviewerRoutes[0]?.requestCoworker.initiativeReviewBinding?.expectedCurrentBaselineId)
      .toBe("IBL-7C41");
  });

  it("binds the reader to the canonical artifact commit without changing the Workroom request key", async () => {
    const artifactCommitSha = "a".repeat(40);
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact: { ...canonicalArtifact, commitSha: artifactCommitSha },
      expectedCurrentBaselineId: "IBL-7C41",
    });

    expect(recovery.reviewerRoutes[0]?.requestCoworker).toMatchObject({
      requestKey: `initiative-readiness:BI-A45D744A:research:${dispatchContext.headSha}`,
      initiativeReviewBinding: {
        artifactRef: { commitSha: artifactCommitSha },
      },
    });
    expect(recovery.reviewerRoutes[0]?.requestCoworker.objective).toContain(`at ${artifactCommitSha}`);
  });

  it("escalates with the provider remedy instead of emitting a route no coworker can execute", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("initiative_design_review", "AGT-WS-REVIEW", "Independent Reviewer"),
      ]) } },
      dispatchContext,
      canonicalArtifact: { resolved: false, nextAction: "Commit the canonical design under docs/superpowers/specs/, push it, then retry." },
    });

    // The missing baseline makes spec approval the prerequisite. Both remaining
    // routes inspect immutable bytes, so neither may be emitted without one.
    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations).toMatchObject([
      {
        accountableRole: "design-author",
        reason: "no-canonical-artifact",
        nextAction: "Commit the canonical design under docs/superpowers/specs/, push it, then retry.",
      },
      {
        accountableRole: "design-checklist-reviewer",
        reason: "no-canonical-artifact",
        nextAction: "Commit the canonical design under docs/superpowers/specs/, push it, then retry.",
      },
    ]);
  });

  it("surfaces an unmet requirement whose accountable role owns no writer lane", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: {
        ...decision,
        unmet: [
          readinessRequirement({ code: "ARTIFACT_AUTHOR_REQUIRED", state: "missing", accountableRole: "artifact-resolver" }),
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
        grantRow("initiative_design_review", "AGT-WS-REVIEW", "Independent Reviewer"),
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
        accountableRole: "design-checklist-reviewer",
        toolName: "record_initiative_design_review",
        grant: "initiative_design_review",
        reason: "dispatch-context-required",
      },
    ]);
    // and it must name the reviewer it found, so the caller can see the roster is healthy
    expect(recovery.escalations[0]!.nextAction).toContain("AGT-WS-BUILD");
  });

  it("exposes generic plan coverage only after a baseline exists", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: {
        ...decision,
        unmet: [
          readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" }),
        ],
      },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: "IBL-CANONICAL",
    });

    expect(recovery.escalations).toEqual([]);
    expect(recovery.reviewerRoutes).toHaveLength(1);
    expect(recovery.reviewerRoutes[0]).toMatchObject({
      accountableRole: "implementation-planner",
      toolName: "record_plan_backlog_coverage",
      grant: "backlog_write",
      gate: "dependency-disposition",
    });
    expect(recovery.reviewerRoutes[0]?.requestCoworker)
      .not.toHaveProperty("initiativeReviewBinding");
    expect(recovery.reviewerRoutes[0]?.requestCoworker)
      .not.toHaveProperty("requiredToolNames");
  });

  it("turns a plan-only missing-baseline state into one executable spec-approval route", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: {
        ...decision,
        unmet: [
          readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" }),
        ],
      },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_design_review", "AGT-WS-REVIEW", "Independent Reviewer"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: null,
    });

    expect(recovery.reviewerRoutes).toHaveLength(1);
    expect(recovery.reviewerRoutes[0]).toMatchObject({
      accountableRole: "design-checklist-reviewer",
      toolName: "record_initiative_design_review",
      grant: "initiative_design_review",
      gate: "spec-approval",
      targetAgentId: "AGT-WS-REVIEW",
      requestCoworker: {
        requiredToolNames: ["record_initiative_design_review", "read_source_at_version"],
        initiativeReviewBinding: {
          expectedCurrentBaselineId: null,
          artifactRef: {
            commitSha: dispatchContext.headSha,
            providerBlobId: canonicalArtifact.providerBlobId,
          },
        },
      },
    });
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

/**
 * The producer/consumer seam, tested end to end.
 *
 * The defect this file's fix repaired (BI-9FE775F9) was not a wrong value — it
 * was a packet the CALLEE rejects. Asserting the emitted shape here and the
 * validator's rules over there let a route that no coworker could execute look
 * correct on both sides for weeks. These tests run what the generator actually
 * emits through the real validators, so the seam cannot silently reopen.
 */
describe("recovery packets are executable by the real consumer", () => {
  // Mirrors initiativeReviewPacket in external-coworker-task-adapter.ts.
  const ALLOWED_READERS = new Set(["read_source_at_version", "search_source_at_version"]);

  it("emits bindings that parseInitiativeReviewBinding accepts", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: null,
    });

    expect(recovery.reviewerRoutes.length).toBeGreaterThan(0);
    for (const route of recovery.reviewerRoutes) {
      if (route.requestCoworker.initiativeReviewBinding === undefined) {
        // Only a non-record_initiative_* writer may go unbound.
        expect(route.toolName.startsWith("record_initiative_")).toBe(false);
        continue;
      }
      expect(
        parseInitiativeReviewBinding(route.requestCoworker.initiativeReviewBinding),
        `parseInitiativeReviewBinding rejected the packet for ${route.toolName}`,
      ).not.toBeNull();
    }
  });

  it("emits requiredToolNames the external coworker adapter will not refuse", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
        grantRow("backlog_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: null,
    });

    for (const route of recovery.reviewerRoutes) {
      const { requiredToolNames, initiativeReviewBinding } = route.requestCoworker;
      if (requiredToolNames === undefined || initiativeReviewBinding === undefined) continue;
      const names = [...new Set(requiredToolNames)];
      // The adapter refuses anything outside the bound writer plus one or both
      // immutable readers, and refuses fewer than 2 or more than 4 names.
      expect(names.length).toBeGreaterThanOrEqual(2);
      expect(names.length).toBeLessThanOrEqual(4);
      expect(names).toContain(initiativeReviewBinding.writerToolName);
      expect(names.some((name) => ALLOWED_READERS.has(name))).toBe(true);
      expect(names.every((name) =>
        name === initiativeReviewBinding.writerToolName || ALLOWED_READERS.has(name))).toBe(true);
    }
  });

  it("never emits one of the two coupled fields without the other", async () => {
    // The adapter rejects "supplied together" violations, so a route carrying
    // only one is an unexecutable route — the exact original defect.
    const recovery = await resolveInitiativeReviewerRecovery({
      decision,
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        grantRow("initiative_evidence_write", "AGT-WS-BUILD", "Build Specialist"),
      ]) } },
      dispatchContext,
      canonicalArtifact,
      expectedCurrentBaselineId: null,
    });

    for (const route of recovery.reviewerRoutes) {
      const hasBinding = route.requestCoworker.initiativeReviewBinding !== undefined;
      const hasNames = route.requestCoworker.requiredToolNames !== undefined;
      // Coupling is the invariant, not presence: the adapter refuses one
      // without the other, so either both travel or neither does.
      expect(hasBinding).toBe(hasNames);
    }
  });
});
