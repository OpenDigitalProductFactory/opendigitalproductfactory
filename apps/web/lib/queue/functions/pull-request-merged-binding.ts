// BI-A6E4D205 — bind a Workroom to the pull request that delivered it, at the
// moment it merges.
//
// `resolvePullRequestBindings` (BI-0B3FED3D, #5218) already derives the binding
// from the branch that determines it, and already refuses to overwrite an
// existing answer. What it never had was a trigger: nothing observed a merge,
// so `pullRequestNumber` was null on all 422 rooms measured 2026-09-08, and
// `classifyWorkCapsuleLiveness` could never reach its open-PR precedence rule.
//
// This is the first subscriber to the merge event. It is deliberately the
// smallest useful one — bind and record — so it can ship and be judged before
// the reaping and completion subscribers depend on the same signal.

import { inngest } from "../inngest-client";

/** A room this event could be about: same head branch, not already bound. */
export type MergeBindingCandidate = {
  id: string;
  capsuleId: string;
  headBranch: string | null;
  pullRequestNumber: number | null;
};

export type MergeBindingPlan =
  | { bind: true; roomId: string; capsuleId: string; pullRequestNumber: number }
  | { bind: false; reason: MergeBindingSkipReason };

export type MergeBindingSkipReason =
  /** No live room claims this branch. Common and fine: not every merge has a room. */
  | "no-room-for-branch"
  /** Already bound. Re-delivery of the same webhook must not rewrite history. */
  | "already-bound"
  /** Bound to a DIFFERENT pull request. Two answers is a conflict, not an update. */
  | "bound-to-another-pull-request";

/**
 * Decide, purely, whether this merge binds to this room.
 *
 * Idempotent by construction: a second delivery of the same webhook finds the
 * room already bound and reports `already-bound` rather than writing again.
 * A room bound to a DIFFERENT number is never silently repointed — that is a
 * conflict a person should see, not something a webhook resolves.
 */
export function planMergeBinding(
  room: MergeBindingCandidate | null,
  pullRequestNumber: number,
): MergeBindingPlan {
  if (!room) return { bind: false, reason: "no-room-for-branch" };
  if (room.pullRequestNumber === pullRequestNumber) {
    return { bind: false, reason: "already-bound" };
  }
  if (room.pullRequestNumber !== null) {
    return { bind: false, reason: "bound-to-another-pull-request" };
  }
  return { bind: true, roomId: room.id, capsuleId: room.capsuleId, pullRequestNumber };
}

export const pullRequestMergedBinding = inngest.createFunction(
  {
    id: "build/pr-merged-binding",
    retries: 3,
    concurrency: [{ limit: 1, scope: "fn" }],
    triggers: [{ event: "build/pr-merged.received" }],
  },
  async ({ event, step }) => {
    const { headRefName, number, mergedAt, mergeCommitSha } = event.data as {
      headRefName: string;
      number: number;
      mergedAt: string | null;
      mergeCommitSha: string | null;
    };

    const room = await step.run("find-room-for-branch", async () => {
      const { prisma } = await import("@dpf/db");
      // Newest first: a branch name can be reused across rooms over time, and
      // the most recent claimant is the one that produced this merge.
      return prisma.workroom.findFirst({
        where: { headBranch: headRefName, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: { id: true, capsuleId: true, headBranch: true, pullRequestNumber: true },
      });
    });

    const plan = planMergeBinding(room, number);
    if (!plan.bind) {
      return { bound: false, reason: plan.reason, headRefName, number };
    }

    await step.run("bind-and-record", async () => {
      const { prisma } = await import("@dpf/db");
      await prisma.workroom.update({
        where: { id: plan.roomId },
        data: { pullRequestNumber: plan.pullRequestNumber },
      });
      await prisma.workroomActivity.create({
        data: {
          workCapsuleId: plan.roomId,
          kind: "evidence",
          summary:
            `Pull request #${plan.pullRequestNumber} merged` +
            `${mergedAt ? ` at ${mergedAt}` : ""}. Bound from the merge webhook, not a poll.`,
          payload: { pullRequestNumber: plan.pullRequestNumber, headRefName, mergedAt, mergeCommitSha },
        },
      });
    });

    return { bound: true, capsuleId: plan.capsuleId, number, headRefName };
  },
);
