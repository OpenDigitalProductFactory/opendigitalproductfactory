import { describe, expect, it } from "vitest";

import { loadWorkroomRecoveryItems, projectWorkroomRecovery, projectWorkroomIdentityRepair } from "./workroom-recovery-projection";
import type { ReviewerExecutionObservation } from "@/lib/work-management/semantic-review-room-projection";

const identity = {
  repositoryFullName: "owner/repo",
  headBranch: "fix/recovery",
  worktreePath: "D:/worktree",
  baseSha: "0".repeat(40),
  headSha: "1".repeat(40),
};

describe("projectWorkroomRecovery", () => {
  it.each(["completed", "failed", "canceled", "rejected", "archived"])(
    "projects canonical terminal TaskRun status %s as terminal",
    (status) => {
      expect(projectWorkroomRecovery({
        ...identity,
        taskRun: { taskRunId: `TR-${status}`, status },
      })).toMatchObject({
        state: "terminal",
        reviewerExecution: { status, pending: false },
      });
    },
  );

  it.each([
    ["submitted", "queued", true], ["working", "working", true], ["active", "working", true],
    ["input-required", "waiting", true], ["auth-required", "waiting", true],
    ["stalled", "waiting", true], ["quiescing", "waiting", true],
    ["paused-for-upgrade", "waiting", true], ["paused-for-upgrade-forced", "waiting", true],
    ["future-status", "unknown", null],
  ])(
    "projects recorded status %s as %s without claiming queued execution",
    (status, state, pending) => {
      expect(projectWorkroomRecovery({
        ...identity,
        taskRun: { taskRunId: `TR-${status}`, status: String(status) },
      })).toMatchObject({
        state,
        reviewerExecution: { status, pending },
      });
    },
  );
});

describe("identity repair packet (observed 2026-09-23: the packet could not be replayed)", () => {
  it.each(["baseSha", "headSha"] as const)("repairs an invalid legacy %s without retaining it in the executable packet", field => {
    const repair = projectWorkroomIdentityRepair({ ...identity, [field]: "abc123" }, { title: "Repair", [field]: "unverified-packet-value" });
    expect(repair).not.toBeNull();
    expect(repair?.missingFields).toEqual([field]);
    expect(repair?.retainedFields).not.toHaveProperty(field);
    expect(repair?.packet).not.toHaveProperty(field);
    expect(repair?.packet).toMatchObject({ title: "Repair", [field === "baseSha" ? "headSha" : "baseSha"]:
      identity[field === "baseSha" ? "headSha" : "baseSha"] });
  });

  it("carries every field adopt_worktree requires, and names the missing SHAs", () => {
    const recovery = projectWorkroomRecovery({
      ...identity,
      baseSha: null,
      title: "Work on BI-X",
      objective: "Claim-at-start binding for BI-X",
      backlogItemId: "BI-X",
      baseBranch: "main",
    });
    expect(recovery.state).toBe("blocked");
    expect(recovery.prerequisite?.repair.packet).toMatchObject({
      title: "Work on BI-X",
      objective: "Claim-at-start binding for BI-X",
      backlogItemId: "BI-X",
      repositoryFullName: "owner/repo",
      headBranch: "fix/recovery",
      worktreePath: "D:/worktree",
      headSha: "1".repeat(40),
    });
    expect(recovery.prerequisite?.missingFields).toEqual(["baseSha"]);
    expect(recovery.prerequisite?.nextAction).toContain("baseSha");
  });
});

const reviewRoom = { ...identity, capsuleId: "WC-1" };
const reviewRun = (patch: Partial<ReviewerExecutionObservation> = {}): ReviewerExecutionObservation => ({
  capsuleId: "WC-1", taskRunId: "TR-REVIEW", recordId: "review-row", status: "working", requesterId: "requester-1",
  requesterName: "Alex", reason: null, nextAction: "The server owns continuation; await its next recorded result.",
  readAt: "2026-10-16T00:00:00Z", lastHeartbeatAt: "2026-10-15T23:59:50Z", heartbeat: "recent",
  recoveryWait: false, budget: { deadlineAt: "2026-10-16T00:10:00Z", recoveryAttempt: 0 },
  identityScope: "current", sourceHeadSha: identity.headSha, checkpoints: [], ...patch,
});
const reviewView = (runs: ReviewerExecutionObservation[], partial = false) => ({ runs, partial, attentionReason: null });

describe("metadata-linked semantic review recovery", () => {
  it("keeps failed linkage lookup unresolved while retaining semantic links and rejecting unrelated lookup rows", async () => {
    const rooms = [{ backlogItemId: "BI-1" }, { backlogItemId: "raw-row" }];
    const failed = await loadWorkroomRecoveryItems({ backlogItem: { findMany: async () => { throw new Error("unavailable"); } } }, rooms);
    expect([...failed]).toEqual([["BI-1", "BI-1"]]);
    const result = await loadWorkroomRecoveryItems({ backlogItem: { findMany: async () => [
      { id: "another-row", itemId: "BI-OTHER" }, { id: "raw-row", itemId: "malformed" },
    ] } }, rooms);
    expect([...result]).toEqual([["BI-1", "BI-1"]]);
  });
  it("never emits a raw backlog row id as a semantic tool argument without normalization", () => {
    const recovery = projectWorkroomRecovery({ ...reviewRoom, backlogItemId: "raw-row-id" }, reviewView([], true));
    expect(recovery.blocker?.action).toBeNull();
  });
  it("bounds historical summaries and marks truncation without promoting their receipts", () => {
    const runs = Array.from({ length: 7 }, (_, index) => reviewRun({ taskRunId: `TR-OLD-${index}`, identityScope: "historical",
      sourceHeadSha: "b".repeat(40), status: "completed", receipt: { id: `receipt-${index}`, decision: "pass", summary: "Old pass" } }));
    const recovery = projectWorkroomRecovery({ ...reviewRoom, backlogItemId: "BI-1" }, reviewView(runs));
    expect(recovery.reviewerExecution).toBeNull();
    expect(recovery.state).toBe("unknown");
    expect(recovery.historicalReviewerExecutions).toHaveLength(5);
    expect(recovery.historicalReviewHistoryTruncated).toBe(true);
    expect(recovery.historicalReviewerExecutions.every(run => run.identityScope === "historical")).toBe(true);
  });

  it.each(["partial", "conflicting"])("names recovery ownership and issuer for %s evidence instead of repeating the room read", kind => {
    const recovery = projectWorkroomRecovery({ ...reviewRoom, backlogItemId: "BI-1" },
      reviewView(kind === "conflicting" ? [reviewRun(), reviewRun({ taskRunId: "TR-OTHER" })] : [], kind === "partial"));
    expect(recovery.state).toBe("unknown");
    expect(recovery.blocker).toMatchObject({ accountableOwner: { role: "delivery-coordinator" },
      action: { toolName: "get_backlog_item", args: { itemId: "BI-1", recoveryGate: "post-implementation-review" } } });
  });

  it("does not promise a self-read repairs an unlinked room and never exposes an unbound history", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ identityScope: "unknown", sourceHeadSha: null })], true));
    expect(recovery.blocker).toMatchObject({ accountableOwner: { role: "delivery-coordinator" } });
    expect(recovery.blocker?.action).toBeNull();
    expect(recovery.blocker?.nextAction).toContain("Link this Workroom");
    expect(recovery.historicalReviewerExecutions).toEqual([]);
  });

  it("limits incomplete evidence to its identified Workroom", () => {
    const otherPartial = { ...reviewView([reviewRun()], true), partialCapsuleIds: ["WC-OTHER"] };
    const recovery = projectWorkroomRecovery(reviewRoom, otherPartial);
    expect(recovery.state).toBe("working");
    expect(recovery.blocker).toBeNull();
    expect(recovery.reviewerExecutionsTruncated).toBe(false);
    expect(recovery.historicalReviewHistoryTruncated).toBe(false);
    expect(projectWorkroomRecovery(reviewRoom, { ...otherPartial, runs: [] }).state).toBe("actionable");
    const ownPartial = projectWorkroomRecovery(reviewRoom, { ...otherPartial, partialCapsuleIds: ["WC-1"] });
    expect(ownPartial.state).toBe("unknown");
    expect(ownPartial.blocker?.reason).toBe("review-observation-incomplete");
    expect(ownPartial.reviewerExecutionsTruncated).toBe(true);
  });

  it("shows a current review even when the direct taskRun relation is empty", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun()]));
    expect(recovery.state).toBe("working");
    expect(recovery.reviewerExecution).toMatchObject({ taskRunId: "TR-REVIEW", status: "working", pending: true,
      accountableOwner: { userId: "requester-1", displayName: "Alex" }, heartbeat: "recent" });
  });

  it.each(["pass", "fail", "inconclusive"] as const)("exposes the recorded %s receipt without completing the Workroom", decision => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ status: "completed", heartbeat: "historical",
      receipt: { id: "receipt-1", decision, summary: `Native ${decision}` } })]));
    expect(recovery.reviewerExecution).toMatchObject({ pending: false, receipt: { id: "receipt-1", decision } });
    expect(recovery.reviewerExecution?.resultAction).toEqual({ method: "tasks/result", params: { taskId: "TR-REVIEW" }, requiredUserId: "requester-1" });
    expect(recovery.state).toBe(decision === "pass" ? "terminal" : decision === "fail" ? "blocked" : "waiting");
  });

  it("retains the precise wait, requester, original budget and recovery action", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ status: "input-required", recoveryWait: true,
      reason: "provider-outcome-uncertain", nextAction: "Reconcile execution before confirming replacement." })]));
    expect(recovery.state).toBe("waiting");
    expect(recovery.blocker).toMatchObject({ reason: "provider-outcome-uncertain", accountableOwner: { userId: "requester-1" },
      nextAction: "Reconcile execution before confirming replacement." });
    expect(recovery.reviewerExecution?.budget).toEqual({ deadlineAt: "2026-10-16T00:10:00Z", recoveryAttempt: 0 });
  });

  it("does not promote a historical pass or a changed-head observation to current readiness", () => {
    for (const run of [reviewRun({ identityScope: "historical" }), reviewRun({ sourceHeadSha: "f".repeat(40) })]) {
      const recovery = projectWorkroomRecovery(reviewRoom, reviewView([run]));
      expect(recovery.state).toBe("unknown");
      expect(recovery.reviewerExecution).toBeNull();
      expect(recovery.blocker?.reason).toBe("current-review-unavailable");
    }
  });

  it("keeps partial and conflicting observations unknown even beside a pass", () => {
    const pass = reviewRun({ status: "completed", receipt: { id: "receipt-1", decision: "pass", summary: "Passed" } });
    for (const view of [reviewView([pass], true), reviewView([pass, reviewRun({ taskRunId: "TR-OTHER" })])]) {
      expect(projectWorkroomRecovery(reviewRoom, view).state).toBe("unknown");
    }
  });

  it("does not treat completed task status without a receipt as a passing review", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ status: "completed" })]));
    expect(recovery.state).toBe("unknown");
    expect(recovery.blocker?.reason).toBe("review-receipt-unavailable");
  });

  it("keeps identity repair ahead of a current passing review", () => {
    const recovery = projectWorkroomRecovery({ ...reviewRoom, baseSha: null }, reviewView([reviewRun({ status: "completed",
      receipt: { id: "receipt-1", decision: "pass", summary: "Passed" } })]));
    expect(recovery.state).toBe("blocked");
    expect(recovery.prerequisite?.missingFields).toEqual(["baseSha"]);
    expect(recovery.blocker?.reason).toBe("source-identity-missing");
  });

  it("keeps an empty complete review history distinct from an unavailable source", () => {
    expect(projectWorkroomRecovery(reviewRoom, reviewView([])).state).toBe("actionable");
    expect(projectWorkroomRecovery(reviewRoom, reviewView([], true)).state).toBe("unknown");
  });

  it("does not use a sibling room's review even when both rooms have the same head", () => {
    expect(projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ capsuleId: "WC-OTHER" })])).reviewerExecution).toBeNull();
  });

  it("does not relabel a resumed working generation with its earlier inconclusive receipt", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({
      receipt: { id: "prior-receipt", decision: "inconclusive", summary: "Capacity was unavailable." },
    })]));
    expect(recovery.state).toBe("working");
    expect(recovery.reviewerExecution).toMatchObject({ pending: true, receipt: null });
  });

  it("exposes a stale heartbeat as an observation without claiming fresh execution", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([reviewRun({ heartbeat: "stale",
      lastHeartbeatAt: "2026-10-15T23:00:00Z" })]));
    expect(recovery.reviewerExecution).toMatchObject({ status: "working", heartbeat: "stale", lastHeartbeatAt: "2026-10-15T23:00:00Z" });
  });
});


describe("ordinary initiative review observations", () => {
  const ordinary = (patch: Partial<ReviewerExecutionObservation> = {}) => reviewRun({
    reviewKind: "initiative-review", reviewGate: "spec-approval", requestDigest: "a".repeat(64),
    artifactVersion: "9".repeat(40), executionUncertain: false, identityConflict: false,
    recoveryWait: false, budget: { deadlineAt: null, recoveryAttempt: null }, ...patch,
  });
  it("keeps each current gate and its exact original result action", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([
      ordinary({ taskRunId: "TR-SPEC", status: "input-required", reason: "missing-terminal-writer" }),
      ordinary({ taskRunId: "TR-ARCH", reviewGate: "architecture-review" }),
    ]));
    expect(recovery.state).toBe("waiting");
    expect(recovery.reviewerExecution).toBeNull();
    expect(recovery.blocker?.reason).not.toBe("review-identity-conflict");
    expect(recovery.reviewerExecutions).toMatchObject([
      { taskRunId: "TR-SPEC", reviewGate: "spec-approval", artifactVersion: "9".repeat(40),
        resultAction: { method: "tasks/result", params: { taskId: "TR-SPEC", requestDigest: "a".repeat(64) } } },
      { taskRunId: "TR-ARCH", reviewGate: "architecture-review" },
    ]);
  });
  it("does not let a current pass hide an unresolved historical original", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([
      reviewRun({ status: "completed", receipt: { id: "pass", decision: "pass", summary: "Passed" } }),
      ordinary({ taskRunId: "TR-OLD", identityScope: "historical", sourceHeadSha: "b".repeat(40),
        status: "input-required", executionUncertain: true }),
    ]));
    expect(recovery.state).toBe("unknown");
    expect(recovery.blocker?.reason).toBe("historical-review-unresolved");
    expect(recovery.reviewerExecutions).toEqual(expect.arrayContaining([expect.objectContaining({ taskRunId: "TR-OLD" })]));
  });
  it.each(["uncertain", "conflicting", "partial"])("keeps %s evidence unknown while preserving originals", cause => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView([
      ordinary({ executionUncertain: cause === "uncertain", identityConflict: cause === "conflicting" }),
    ], cause === "partial"));
    expect(recovery.state).toBe("unknown");
    expect(recovery.reviewerExecutions).toHaveLength(1);
  });
  it("bounds the collection explicitly and never sends a malformed digest", () => {
    const recovery = projectWorkroomRecovery(reviewRoom, reviewView(Array.from({ length: 21 }, (_, i) =>
      ordinary({ taskRunId: "TR-" + i, reviewGate: "gate-" + i, requestDigest: "invalid" }))));
    expect(recovery.state).toBe("unknown");
    expect(recovery.reviewerExecutions).toHaveLength(20);
    expect(recovery.reviewerExecutionsTruncated).toBe(true);
    expect(recovery.reviewerExecutions[0].resultAction?.params).toEqual({ taskId: "TR-0" });
  });
});
