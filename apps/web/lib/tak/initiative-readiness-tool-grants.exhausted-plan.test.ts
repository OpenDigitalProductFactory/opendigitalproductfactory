import { describe, expect, it, vi } from "vitest";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";
const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-PLAN", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-PLAN" },
  transitionObject: { kind: "work-capsule", id: "WC-PLAN", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "fix", target: "implementation", verdict: "input-required", satisfied: [], blockers: [], unmet: [],
  evaluatedAt: "2026-10-12T20:00:00Z",
};
const dispatchContext = { workroomId: "WC-PLAN", repositoryFullName: "org/repo", branchName: "fix/plan", headSha: "a".repeat(40) };
function boundGrantRows(grantKey: string, agentId: string, displayName: string) {
  return [grantKey, "file_read"].map(grantKey => ({ grantKey,
    agent: { agentId, displayName, status: "active", archived: false, lifecycleStage: "production" } }));
}
describe("exact exhausted plan reviewer selection", () => {
  it("moves an exhausted exact plan packet to the next eligible independent reviewer", async () => {
    const exhausted = vi.fn(async (packet: { targetAgent: string }) => packet.targetAgent === "AGT-A");
    const input = {
      decision: { ...decision, unmet: [readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" })] },
      currentAgentId: "AGT-AUTHOR", dispatchContext, expectedCurrentBaselineId: "BASE-1",
      planArtifact: { resolved: true as const, path: "docs/superpowers/plans/recovery.md", commitSha: "b".repeat(40), providerBlobId: "a".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue([
        ...boundGrantRows("initiative_design_review", "AGT-A", "First"),
        ...boundGrantRows("initiative_design_review", "AGT-B", "Next"),
      ]) } },
      isPlanReviewExhausted: exhausted,
    };
    const recovery = await resolveInitiativeReviewerRecovery(input);
    expect(recovery.reviewerRoutes[0]?.requestCoworker.targetAgent).toBe("AGT-B");
    expect(exhausted).toHaveBeenCalledTimes(2);
    const original = await resolveInitiativeReviewerRecovery({ ...input, isPlanReviewExhausted: undefined });
    expect(original.reviewerRoutes[0]?.requestCoworker.targetAgent).toBe("AGT-A");
    expect(recovery.reviewerRoutes[0]?.requestCoworker.requestKey).not.toBe(original.reviewerRoutes[0]?.requestCoworker.requestKey);
    expect(recovery.reviewerRoutes[0]?.requestCoworker.initiativeReviewBinding).toEqual(original.reviewerRoutes[0]?.requestCoworker.initiativeReviewBinding);
  });

  it("stops issuance when every eligible plan reviewer has exhausted this packet", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" })] },
      currentAgentId: "AGT-AUTHOR", dispatchContext, expectedCurrentBaselineId: "BASE-1",
      planArtifact: { resolved: true, path: "docs/superpowers/plans/recovery.md", commitSha: "b".repeat(40), providerBlobId: "a".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_design_review", "AGT-A", "First")) } },
      isPlanReviewExhausted: async () => true,
    } as Parameters<typeof resolveInitiativeReviewerRecovery>[0]);
    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations[0]?.nextAction).toContain("exhausted");
  });

});
