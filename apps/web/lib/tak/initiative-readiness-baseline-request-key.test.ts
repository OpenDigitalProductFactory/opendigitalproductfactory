import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";

// BI-D3E1F6D9: request identity for independent reviews across the moment the
// objective baseline is minted. Kept apart from the main routing suite, which
// sits at its module-size ceiling.

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-BASELINE-KEY",
  policyVersion: "initiative-readiness.v2",
  subject: { kind: "backlog-item", id: "BI-A45D744A" },
  transitionObject: { kind: "work-capsule", id: "WC-04941646", expectedVersion: "claim.v1", targetState: "plan" },
  profile: "feature",
  target: "plan",
  verdict: "input-required",
  satisfied: [],
  unmet: [readinessRequirement({ code: "REVIEW_REQUIRED", state: "missing", accountableRole: "architecture-reviewer" })],
  blockers: [],
  evaluatedAt: "2026-09-26T06:00:00.000Z",
};

const dispatchContext = {
  workroomId: "WC-04941646",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branchName: "feat/example",
  headSha: "21103703757a342c828dd6ef1bb9acc97a4b01f8",
};

const canonicalArtifact = {
  resolved: true as const,
  path: "docs/superpowers/specs/2026-09-26-example-design.md",
  providerBlobId: "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e",
};

function boundGrantRows(grantKey: string, agentId: string, displayName: string) {
  const agent = { agentId, displayName, status: "active", archived: false, lifecycleStage: "production" };
  return [{ grantKey, agent }, { grantKey: "file_read", agent }];
}

describe("independent review request identity across the baseline", () => {
  it("BI-D3E1F6D9: a review packet issued after its baseline exists never reuses the pre-baseline requestKey", async () => {
    const packet = async (expectedCurrentBaselineId: string | null) => {
      const recovery = await resolveInitiativeReviewerRecovery({
        decision,
        currentAgentId: "AGT-AUTHOR",
        db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_architecture_review", "AGT-EA", "Enterprise Architect")) } },
        dispatchContext, canonicalArtifact, expectedCurrentBaselineId,
      });
      return recovery.reviewerRoutes.find((route) => route.gate === "architecture-review")!.requestCoworker.requestKey;
    };
    const beforeBaseline = await packet(null);
    // Unchanged before a baseline exists: existing callers and replays keep their key.
    expect(beforeBaseline).toBe(`initiative-readiness:BI-A45D744A:architecture-review:${dispatchContext.headSha}`);
    const afterBaseline = await packet("baseline-1");
    expect(afterBaseline).not.toBe(beforeBaseline);
    expect(afterBaseline.startsWith(`${beforeBaseline}:baseline:`)).toBe(true);
    // Deterministic per baseline, distinct across baselines.
    expect(await packet("baseline-1")).toBe(afterBaseline);
    expect(await packet("baseline-2")).not.toBe(afterBaseline);
  });

});
