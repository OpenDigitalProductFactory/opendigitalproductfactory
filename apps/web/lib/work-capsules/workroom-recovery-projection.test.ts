import { describe, expect, it } from "vitest";

import { projectWorkroomRecovery } from "./workroom-recovery-projection";
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
