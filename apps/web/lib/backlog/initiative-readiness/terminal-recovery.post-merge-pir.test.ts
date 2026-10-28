// BI-CE661173 — a merged break-fix's post-implementation review is routable
// after merge. The delivering Workroom is archived or idle by then, so the
// review reads the merged squash commit on the trunk, anchored to the
// delivery's own room, and is routed only to a reviewer who delivered nothing.
import { describe, expect, it, vi } from "vitest";

import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";
import { resolveTerminalInitiativeRecovery, type MergedRepairSource, type TerminalRecoveryPorts } from "./terminal-recovery";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const mergedSha = "a".repeat(40);
const parentSha = "b".repeat(40);
const blob = "3".repeat(40);

const pirDecision: InitiativeReadinessDecision = {
  decisionId: "IRD-PIR",
  policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-MERGED" },
  transitionObject: { kind: "backlog-item", id: "BI-MERGED", expectedVersion: "awaiting-acceptance", targetState: "done" },
  profile: "fix",
  target: "completion",
  verdict: "input-required",
  satisfied: [],
  unmet: [readinessRequirement({ code: "POST_IMPLEMENTATION_REVIEW_REQUIRED", state: "missing", accountableRole: "post-implementation-reviewer" })],
  blockers: [],
  evaluatedAt: "2026-10-27T12:00:00.000Z",
};

const archivedRoom = {
  capsuleId: "WC-ARCHIVED",
  backlogItemId: "BI-MERGED",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha,
  headBranch: "fix/merged",
  headSha,
  isLive: false,
};

const agent = (agentId: string) => ({ agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production" });

/** Grant holders for the PIR lane: each holds the writer grant and the immutable reader. */
function reviewerDb(agentIds: string[]) {
  return { agentToolGrant: { findMany: async () => agentIds.flatMap((id) => [
    { grantKey: "initiative_design_review", agent: agent(id) },
    { grantKey: "file_read", agent: agent(id) },
  ]) } };
}

function ports(input: {
  liveRooms?: Array<typeof archivedRoom & { isLive: boolean }>;
  source?: MergedRepairSource;
  reviewers?: string[];
}): TerminalRecoveryPorts {
  return {
    loadLiveRooms: vi.fn().mockResolvedValue(input.liveRooms ?? []),
    loadMergedRepairSource: vi.fn().mockResolvedValue(input.source ?? {
      kind: "found", room: archivedRoom, mergedCommitSha: mergedSha, parentSha,
      deliveryActorIds: ["AGT-AUTHOR", "AGT-PAST-CONTRIBUTOR"],
    }),
    loadBaselinePayloads: vi.fn().mockResolvedValue([]),
    loadEligibleEvidenceActivityIds: vi.fn(),
    loadObjectiveMappingHistory: vi.fn(),
    verifyHistoricalArtifact: vi.fn(),
    discoverArtifact: vi.fn().mockResolvedValue({ resolved: true, artifact: { path: "apps/web/lib/fix.ts", providerBlobId: blob } }),
    resolveRecovery: vi.fn().mockImplementation((args) => resolveInitiativeReviewerRecovery({
      ...args, db: reviewerDb(input.reviewers ?? ["AGT-REVIEW"]) as never,
    })),
    loadPlanArtifact: vi.fn(),
  };
}

describe("post-implementation review after merge (BI-CE661173)", () => {
  it("issues a reviewer route for a merged repair whose Workroom is archived", async () => {
    const p = ports({});
    const result = await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-AUTHOR", refusedWorkroomId: null, ports: p });

    expect(result.escalations).toEqual([]);
    expect(result.reviewerRoutes).toHaveLength(1);
    const route = result.reviewerRoutes[0]!;
    expect(route).toMatchObject({ gate: "post-implementation-review", targetAgentId: "AGT-REVIEW", independent: true,
      workroomId: archivedRoom.capsuleId, headSha });
    // The reviewed bytes are the merged squash commit; the room anchors the request.
    expect(route.requestCoworker.initiativeReviewBinding).toMatchObject({
      writerToolName: "record_initiative_post_implementation_review",
      gate: "post-implementation-review",
      expectedCurrentBaselineId: null,
      workroomRef: { workroomId: archivedRoom.capsuleId, branchName: archivedRoom.headBranch, headSha },
      artifactRef: { kind: "repo-blob-at-commit", commitSha: mergedSha, path: "apps/web/lib/fix.ts", providerBlobId: blob },
    });
    expect(p.discoverArtifact).toHaveBeenCalledWith({ repositoryFullName: archivedRoom.repositoryFullName,
      baseSha: parentSha, headSha: mergedSha, purpose: "post-implementation-review" });
    expect(p.loadMergedRepairSource).toHaveBeenCalledWith({ itemId: "BI-MERGED", refusedWorkroomId: null });
  });

  it("never routes the review to anyone who delivered the repair, not only the caller", async () => {
    // The caller is a third party; an older contributor holds the grant too.
    const p = ports({ reviewers: ["AGT-PAST-CONTRIBUTOR", "AGT-REVIEW"] });
    const result = await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-SWEEP", refusedWorkroomId: null, ports: p });
    expect(result.reviewerRoutes.map((route) => route.targetAgentId)).toEqual(["AGT-REVIEW"]);

    const onlyAuthors = await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-SWEEP", refusedWorkroomId: null,
      ports: ports({ reviewers: ["AGT-AUTHOR", "AGT-PAST-CONTRIBUTOR"] }) });
    expect(onlyAuthors.reviewerRoutes).toEqual([]);
    expect(onlyAuthors.escalations).toEqual([expect.objectContaining({ reason: "no-eligible-reviewer" })]);
  });

  it("reviews the merged commit when the live room's recorded range is empty (BI-17238133)", async () => {
    const emptyRange = { ...archivedRoom, capsuleId: "WC-EMPTY", baseSha: headSha, isLive: true };
    const p = ports({ liveRooms: [emptyRange], source: { kind: "found", room: emptyRange, mergedCommitSha: mergedSha, parentSha, deliveryActorIds: ["AGT-AUTHOR"] } });
    const result = await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-AUTHOR", refusedWorkroomId: null, ports: p });

    expect(result.escalations).toEqual([]);
    expect(result.reviewerRoutes[0]!.requestCoworker.initiativeReviewBinding).toMatchObject({
      workroomRef: { workroomId: "WC-EMPTY", headSha },
      artifactRef: { commitSha: mergedSha },
    });
    expect(p.loadMergedRepairSource).toHaveBeenCalledWith({ itemId: "BI-MERGED", refusedWorkroomId: "WC-EMPTY" });
    expect(p.discoverArtifact).toHaveBeenCalledWith(expect.objectContaining({ baseSha: parentSha, headSha: mergedSha }));
  });

  it("keeps the live room's own range when it is not empty", async () => {
    const live = { ...archivedRoom, isLive: true };
    const p = ports({ liveRooms: [live] });
    await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-AUTHOR", refusedWorkroomId: null, ports: p });
    expect(p.loadMergedRepairSource).not.toHaveBeenCalled();
    expect(p.discoverArtifact).toHaveBeenCalledWith({ repositoryFullName: live.repositoryFullName, baseSha, headSha, purpose: "post-implementation-review" });
  });

  it.each([
    ["merged-delivery-not-found", "No standing delivering commit."],
    ["merged-delivery-ambiguous", "Two delivering commits."],
    ["delivery-actors-unbounded", "Too many rooms."],
  ] as const)("escalates %s instead of routing an unproven source", async (reason, nextAction) => {
    const p = ports({ source: { kind: "unavailable", reason, nextAction } });
    const result = await resolveTerminalInitiativeRecovery({ decision: pirDecision, currentAgentId: "AGT-AUTHOR", refusedWorkroomId: null, ports: p });
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toEqual([expect.objectContaining({ reason, nextAction })]);
    expect(p.discoverArtifact).not.toHaveBeenCalled();
  });

  it("does not read a retired room for a review other than PIR", async () => {
    const p = ports({});
    const designOwed: InitiativeReadinessDecision = { ...pirDecision,
      unmet: [readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })] };
    const result = await resolveTerminalInitiativeRecovery({ decision: designOwed, currentAgentId: "AGT-AUTHOR", refusedWorkroomId: null, ports: p });
    expect(p.loadMergedRepairSource).not.toHaveBeenCalled();
    expect(result.escalations).toEqual([expect.objectContaining({ reason: "workroom-not-found" })]);
  });
});
