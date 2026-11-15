import { describe, expect, it, vi } from "vitest";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-FAILED-PLAN", policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-6C6CEDCA" },
  transitionObject: { kind: "work-capsule", id: "WC-77650264", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "fix", target: "implementation", verdict: "input-required",
  satisfied: [], unmet: [], blockers: [], evaluatedAt: "2026-11-15T04:54:07.010Z",
};
const dispatchContext = {
  workroomId: "WC-77650264", repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branchName: "codex/failed-plan-review-recovery", headSha: "1".repeat(40),
};
const canonicalArtifact = {
  resolved: true as const, path: "docs/superpowers/specs/design.md", providerBlobId: "2".repeat(40),
};
function grantRow(grantKey: string, agentId: string, displayName: string) {
  return { grantKey, agent: { agentId, displayName, status: "active", archived: false, lifecycleStage: "production" } };
}
function boundGrantRows(grantKey: string, agentId: string, displayName: string) {
  return [grantRow(grantKey, agentId, displayName), grantRow("file_read", agentId, displayName)];
}

describe("failed plan review recovery", () => {
  it.each(["REVIEW_FAILED", "REVIEW_REQUIRED", "BLOCKING_FINDINGS_OPEN"] as const)("routes %s for the plan reviewer to the covered plan", async (code) => {
    const planArtifact = { resolved: true as const, path: "docs/superpowers/plans/repaired-plan.md", providerBlobId: "a".repeat(40), commitSha: "b".repeat(40) };
    const failedDecision = { ...decision, unmet: [readinessRequirement({ code, state: "fail", accountableRole: "plan-reviewer" })] };
    const original = structuredClone(failedDecision);
    const db = { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_design_review", "AGT-REVIEW", "Reviewer")) } };
    const input = { currentAgentId: "AGT-AUTHOR", db, dispatchContext, canonicalArtifact, planArtifact };
    const recovery = await resolveInitiativeReviewerRecovery({ ...input, decision: failedDecision });
    const required = await resolveInitiativeReviewerRecovery({ ...input, decision: { ...decision, unmet: [readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" })] } });
    expect(recovery.unroutable).toEqual([]);
    expect(recovery.reviewerRoutes).toHaveLength(1);
    expect(recovery.reviewerRoutes[0]?.gate).toBe("plan-review");
    expect(recovery.reviewerRoutes[0]?.requestCoworker).toEqual(required.reviewerRoutes[0]?.requestCoworker);
    expect(recovery.reviewerRoutes[0]?.requestCoworker.initiativeReviewBinding?.artifactRef).toMatchObject({ path: planArtifact.path, providerBlobId: planArtifact.providerBlobId, commitSha: planArtifact.commitSha });
    expect(failedDecision).toEqual(original);
  });

  it("keeps a failed checklist review ambiguous instead of selecting a design gate", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [readinessRequirement({ code: "REVIEW_FAILED", state: "fail", accountableRole: "design-checklist-reviewer" })] },
      currentAgentId: "AGT-AUTHOR", db: { agentToolGrant: { findMany: vi.fn() } }, dispatchContext, canonicalArtifact,
    });
    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.unroutable).toMatchObject([{ code: "REVIEW_FAILED", accountableRole: "design-checklist-reviewer" }]);
  });

  it("never substitutes the design for a failed plan's missing coverage", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [readinessRequirement({ code: "REVIEW_FAILED", state: "fail", accountableRole: "plan-reviewer" })] },
      currentAgentId: "AGT-AUTHOR", db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_design_review", "AGT-REVIEW", "Reviewer")) } }, dispatchContext, canonicalArtifact,
    });
    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations[0]?.reason).toBe("no-canonical-artifact");
    expect(recovery.escalations[0]?.nextAction).toContain("plan coverage");
  });

  it.each(["author", "missing-reader"])("keeps failed plan reviewer eligibility closed for %s", async (ineligible) => {
    const rows = ineligible === "author" ? boundGrantRows("initiative_design_review", "AGT-AUTHOR", "Author") : [grantRow("initiative_design_review", "AGT-REVIEW", "Writer only")];
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [readinessRequirement({ code: "REVIEW_FAILED", state: "fail", accountableRole: "plan-reviewer" })] },
      currentAgentId: "AGT-AUTHOR", db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(rows) } }, dispatchContext, canonicalArtifact,
      planArtifact: { resolved: true, path: "docs/superpowers/plans/repaired-plan.md", providerBlobId: "a".repeat(40), commitSha: "b".repeat(40) },
    });
    expect(recovery.reviewerRoutes).toEqual([]);
    expect(recovery.escalations[0]?.reason).toBe("no-eligible-reviewer");
  });

});
