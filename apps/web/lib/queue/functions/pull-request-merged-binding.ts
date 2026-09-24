// BI-A6E4D205 — bind a Workroom to the pull request that delivered it, at the
// moment it merges.
//
// Nothing observed a merge, so `pullRequestNumber` was null on all 422 rooms
// measured 2026-09-08, and `classifyWorkCapsuleLiveness` could never reach its
// open-PR precedence rule. This subscriber reacts to the merge webhook.
//
// It does NOT call `resolvePullRequestBindings` (BI-0B3FED3D, #5218). That
// resolver works from inventory observations and is run by the contributor
// inventory sync every ten minutes, which stays the backstop for a missed
// delivery. This one applies the same two identity rules to a single event
// (BI-C26D5DC5):
//
//   * a room is matched on repository AND head branch — a branch name alone is
//     shared by every fork and every repository this install tracks;
//   * the URL is the canonical https://github.com/<repo>/pull/<n>, the same
//     form the inventory observation requires, so the two writers agree.
//
// It is deliberately the smallest useful subscriber — bind and record — so the
// reaping and completion subscribers can depend on the same signal.

import { inngest } from "../inngest-client";

const FULL_SHA_RE = /^[a-f0-9]{40}$/i;

/** A room this event could be about: same repository and head branch. */
export type MergeBindingCandidate = {
  id: string;
  capsuleId: string;
  repositoryFullName: string | null;
  headBranch: string | null;
  headSha: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
};

/** The merged pull request, as the webhook reported it. */
export type MergedPullRequest = {
  repositoryFullName: string;
  number: number;
  headSha: string;
};

export type MergeBindingPlan =
  | {
      bind: true;
      roomId: string;
      capsuleId: string;
      pullRequestNumber: number;
      pullRequestUrl: string;
      /** Written only when the room recorded no head; never overwrites one. */
      headSha: string | null;
    }
  | { bind: false; reason: MergeBindingSkipReason };

export type MergeBindingSkipReason =
  /** No live room claims this branch. Common and fine: not every merge has a room. */
  | "no-room-for-branch"
  /** Already bound. Re-delivery of the same webhook must not rewrite history. */
  | "already-bound"
  /** Bound to a DIFFERENT pull request. Two answers is a conflict, not an update. */
  | "bound-to-another-pull-request";

/** The canonical pull request URL, in the form the inventory observation requires. */
export function pullRequestUrlFor(repositoryFullName: string, number: number): string {
  return `https://github.com/${repositoryFullName}/pull/${number}`;
}

/**
 * Decide, purely, whether this merge binds to this room.
 *
 * Idempotent by construction: a second delivery of the same webhook finds the
 * room already bound and reports `already-bound` rather than writing again.
 * A room bound to a DIFFERENT number or URL is never silently repointed — that
 * is a conflict a person should see, not something a webhook resolves.
 */
export function planMergeBinding(
  room: MergeBindingCandidate | null,
  merged: MergedPullRequest,
): MergeBindingPlan {
  if (!room) return { bind: false, reason: "no-room-for-branch" };
  const url = pullRequestUrlFor(merged.repositoryFullName, merged.number);
  const sameUrl = room.pullRequestUrl !== null && room.pullRequestUrl.toLowerCase() === url.toLowerCase();

  if (room.pullRequestNumber !== null && room.pullRequestNumber !== merged.number) {
    return { bind: false, reason: "bound-to-another-pull-request" };
  }
  if (room.pullRequestUrl !== null && !sameUrl) {
    return { bind: false, reason: "bound-to-another-pull-request" };
  }
  if (room.pullRequestNumber === merged.number && sameUrl) {
    return { bind: false, reason: "already-bound" };
  }
  return {
    bind: true,
    roomId: room.id,
    capsuleId: room.capsuleId,
    pullRequestNumber: merged.number,
    pullRequestUrl: url,
    headSha: room.headSha === null && FULL_SHA_RE.test(merged.headSha) ? merged.headSha : null,
  };
}

export const pullRequestMergedBinding = inngest.createFunction(
  {
    id: "build/pr-merged-binding",
    retries: 3,
    concurrency: [{ limit: 1, scope: "fn" }],
    triggers: [{ event: "build/pr-merged.received" }],
  },
  async ({ event, step }) => {
    const { repositoryFullName, headRefName, headSha, number, mergedAt, mergeCommitSha } = event.data as {
      repositoryFullName: string;
      headRefName: string;
      headSha: string;
      number: number;
      mergedAt: string | null;
      mergeCommitSha: string | null;
    };

    const room = await step.run("find-room-for-branch", async () => {
      const { prisma } = await import("@dpf/db");
      // Newest first: a branch name can be reused across rooms over time, and
      // the most recent claimant is the one that produced this merge.
      return prisma.workroom.findFirst({
        where: { repositoryFullName, headBranch: headRefName, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          capsuleId: true,
          repositoryFullName: true,
          headBranch: true,
          headSha: true,
          pullRequestNumber: true,
          pullRequestUrl: true,
        },
      });
    });

    const plan = planMergeBinding(room, { repositoryFullName, number, headSha });
    if (!plan.bind) {
      return { bound: false, reason: plan.reason, repositoryFullName, headRefName, number };
    }

    const bound = await step.run("bind-and-record", async () => {
      const { prisma } = await import("@dpf/db");
      return prisma.$transaction(async (tx) => {
        // Compare-and-set on what the plan read. The inventory sync writes the
        // same fields; whoever lands second finds the row changed and stops.
        const update = await tx.workroom.updateMany({
          where: {
            id: plan.roomId,
            archivedAt: null,
            pullRequestNumber: room!.pullRequestNumber,
            pullRequestUrl: room!.pullRequestUrl,
            headSha: room!.headSha,
          },
          data: {
            pullRequestNumber: plan.pullRequestNumber,
            pullRequestUrl: plan.pullRequestUrl,
            ...(plan.headSha ? { headSha: plan.headSha } : {}),
          },
        });
        if (update.count !== 1) return false;
        await tx.workroomActivity.create({
          data: {
            workCapsuleId: plan.roomId,
            kind: "evidence",
            summary:
              `Pull request #${plan.pullRequestNumber} merged` +
              `${mergedAt ? ` at ${mergedAt}` : ""}. Bound from the merge webhook, not a poll.`,
            payload: {
              repositoryFullName,
              pullRequestNumber: plan.pullRequestNumber,
              pullRequestUrl: plan.pullRequestUrl,
              headRefName,
              headSha,
              headShaRecorded: plan.headSha !== null,
              mergedAt,
              mergeCommitSha,
            },
          },
        });
        return true;
      });
    });

    if (!bound) {
      return { bound: false, reason: "room-changed-before-bind", repositoryFullName, headRefName, number };
    }
    return { bound: true, capsuleId: plan.capsuleId, number, headRefName };
  },
);
