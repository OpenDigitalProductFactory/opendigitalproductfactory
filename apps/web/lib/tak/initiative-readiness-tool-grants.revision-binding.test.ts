import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import { parseInitiativeReviewBinding } from "@/lib/mcp-task-submit";

import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";

// BI-926A7E90: a Build Studio design is an accepted BuildArtifactRevision. The
// recovery packet binds a reviewer to it by revision id and value digest and
// hands the reviewer `read_build_artifact_revision`; the repository-blob packet
// stays byte-identical (OBJ-PRESERVE).

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-RECOVERY",
  policyVersion: "initiative-readiness.v2",
  subject: { kind: "backlog-item", id: "BI-A45D744A" },
  transitionObject: { kind: "work-capsule", id: "WC-04941646", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "feature",
  target: "implementation",
  verdict: "input-required",
  satisfied: [],
  unmet: [],
  blockers: [],
  evaluatedAt: "2026-10-02T17:00:00.000Z",
};

const dispatchContext = {
  workroomId: "WC-04941646",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branchName: "build/FB-1",
  headSha: "21103703757a342c828dd6ef1bb9acc97a4b01f8",
};

const canonicalArtifact = {
  resolved: true as const,
  path: "docs/superpowers/specs/2026-10-02-large-lane.md",
  providerBlobId: "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e",
};

function grantRow(grantKey: string, agentId: string, displayName: string) {
  return { grantKey, agent: { agentId, displayName, status: "active", archived: false, lifecycleStage: "production" } };
}

function boundGrantRows(grantKey: string, agentId: string, displayName: string) {
  return [grantRow(grantKey, agentId, displayName), grantRow("file_read", agentId, displayName)];
}

describe("Build Studio design revision binding (BI-926A7E90)", () => {
  it("binds the review to the revision and hands the reviewer read_build_artifact_revision", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [
        readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
      ] },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_design_review", "AGT-REVIEW", "Reviewer")) } },
      dispatchContext,
      canonicalArtifact: { resolved: true, kind: "feature-build-revision", revisionId: "rev_1", valueDigest: "sha256:abc", buildId: "FB-1" },
      expectedCurrentBaselineId: null,
    });
    const route = recovery.reviewerRoutes.find((entry) => entry.gate === "spec-approval")!.requestCoworker;
    expect(route.requiredToolNames).toEqual(["record_initiative_design_review", "read_build_artifact_revision"]);
    expect(route.initiativeReviewBinding?.artifactRef).toEqual({
      kind: "feature-build-revision",
      repositoryFullName: dispatchContext.repositoryFullName,
      revisionId: "rev_1",
      valueDigest: "sha256:abc",
    });
    expect(route.objective).toContain("read_build_artifact_revision");
    expect(route.objective).toContain("sha256:abc");
    expect(parseInitiativeReviewBinding(route.initiativeReviewBinding)).not.toBeNull();
  });

  it("keeps the repository-blob packet byte-identical (AC-3 guard)", async () => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: { ...decision, unmet: [
        readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
      ] },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(boundGrantRows("initiative_design_review", "AGT-REVIEW", "Reviewer")) } },
      dispatchContext, canonicalArtifact, expectedCurrentBaselineId: null,
    });
    const route = recovery.reviewerRoutes.find((entry) => entry.gate === "spec-approval")!.requestCoworker;
    expect(route.requiredToolNames).toEqual(["record_initiative_design_review", "read_source_at_version"]);
    expect(route.requestKey).toBe(`initiative-readiness:${decision.subject.id}:spec-approval:${dispatchContext.headSha}`);
    expect(route.initiativeReviewBinding?.artifactRef).toEqual({
      kind: "repo-blob-at-commit",
      repositoryFullName: dispatchContext.repositoryFullName,
      commitSha: dispatchContext.headSha,
      path: canonicalArtifact.path,
      providerBlobId: canonicalArtifact.providerBlobId,
    });
  });
});
