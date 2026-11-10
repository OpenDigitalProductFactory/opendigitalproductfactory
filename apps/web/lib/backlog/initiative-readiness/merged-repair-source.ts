// BI-CE661173: the source a merged break-fix's post-implementation review
// reads once its delivering Workroom has retired. Split from
// terminal-recovery.ts, which routes it.
import { prisma } from "@dpf/db";

import { MAX_COMMIT_RANGES } from "./repo-commit-range";
import type { TerminalRecoveryEscalationReason, TerminalRecoveryRoom } from "./terminal-recovery";

/**
 * BI-CE661173: the source a post-implementation review reads once the work has
 * merged and its Workroom is no longer live. The room is the delivery's own
 * newest attempt and anchors the request (its recorded identity is what review
 * admission and the PIR evidence context match); the reviewed bytes are the
 * merged squash commit's range on the trunk, `parentSha..mergedCommitSha`.
 *
 * BI-46E344FE: a delivery of several squash commits names them all in
 * `commits`, oldest first, and is reviewed as their ordered union;
 * `mergedCommitSha`/`parentSha` are the newest. A room that never recorded its
 * head is anchored to that newest merged commit.
 */
export type MergedRepairSource =
  | {
    kind: "found";
    room: TerminalRecoveryRoom;
    mergedCommitSha: string;
    parentSha: string;
    /** Every delivering commit, oldest first. Absent means the one `parentSha..mergedCommitSha`. */
    commits?: Array<{ sha: string; parentSha: string }>;
    /** Every agent that delivered the item (delivery-actors.ts); none may review it. */
    deliveryActorIds: string[];
  }
  | { kind: "unavailable"; reason: TerminalRecoveryEscalationReason; nextAction: string };

const FULL_SHA = /^[a-f0-9]{40}$/i;

/** The delivering commits of a found source, oldest first. */
export function mergedRepairCommits(source: Extract<MergedRepairSource, { kind: "found" }>): Array<{ sha: string; parentSha: string }> {
  return source.commits ?? [{ sha: source.mergedCommitSha, parentSha: source.parentSha }];
}

/**
 * BI-CE661173. The newest delivery attempt for the item, when the trunk proves
 * it merged. Like the body-acceptance author (body-baseline-author-room.ts) it
 * never searches backward past a newer attempt, and an abandoned or superseded
 * newest attempt is not a delivery. Resolves source and independence only; it
 * grants no room access and no execution lease.
 */
export async function defaultLoadMergedRepairSource(args: {
  itemId: string;
  refusedWorkroomId: string | null;
}, options: { roots?: readonly string[] } = {}): Promise<MergedRepairSource> {
  const notFound = (nextAction: string): MergedRepairSource => ({ kind: "unavailable", reason: "workroom-not-found", nextAction });
  const item = await prisma.backlogItem.findUnique({ where: { itemId: args.itemId }, select: { id: true, itemId: true, workType: true } });
  if (!item) return notFound(`Backlog item ${args.itemId} was not found.`);
  const attempts = await prisma.workroom.findMany({
    where: { backlogItemId: { in: [item.id, item.itemId] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 2,
    select: { capsuleId: true, backlogItemId: true, repositoryFullName: true, baseSha: true, headBranch: true,
      headSha: true, pullRequestNumber: true, status: true, createdAt: true },
  });
  const room = attempts[0];
  if (!room || (attempts[1] && attempts[1].createdAt.getTime() === room.createdAt.getTime())
    || ["abandoned", "superseded"].includes(room.status)) {
    return notFound("No Workroom is live and the item's newest delivery attempt cannot be identified. Reconcile its Workrooms through governed procedures, then retry.");
  }
  if (args.refusedWorkroomId && room.capsuleId !== args.refusedWorkroomId) {
    return notFound("The requested Workroom is not the item's newest delivery attempt. Read get_backlog_item with recoveryGate \"post-implementation-review\" for the current request.");
  }
  // BI-46E344FE: a room that never recorded its base or head is still the
  // delivery's anchor; the trunk supplies the head below. A recorded value that
  // is not a full sha is a corrupt identity, not a missing one.
  if (!room.repositoryFullName || !room.headBranch
    || (room.headSha !== null && !FULL_SHA.test(room.headSha)) || (room.baseSha !== null && !FULL_SHA.test(room.baseSha))) {
    return { kind: "unavailable", reason: "workroom-identity-incomplete",
      nextAction: "The item's newest Workroom lacks repository or branch, or records a malformed base or head, so a post-merge review cannot be anchored to it. Re-sync it with adopt_worktree, then retry." };
  }
  const { resolveMergedDeliveryCommitFromDb } = await import("./merge-delivery-signal");
  const merged = await resolveMergedDeliveryCommitFromDb(prisma as never, {
    itemRowId: item.id, itemId: item.itemId, workType: item.workType ?? null,
    roomPullRequests: room.pullRequestNumber ? [room.pullRequestNumber] : [],
  }, options);
  if (merged.kind === "ambiguous" && merged.commits.length > MAX_COMMIT_RANGES) {
    return { kind: "unavailable", reason: "merged-delivery-ambiguous",
      nextAction: `${merged.commits.length} standing commits on the trunk delivered ${item.itemId}, more than the ${MAX_COMMIT_RANGES} one post-implementation review can hold. Split the review by filing the later repairs as their own items.` };
  }
  if (merged.kind !== "found" && merged.kind !== "ambiguous") {
    return { kind: "unavailable", reason: "merged-delivery-not-found",
      nextAction: merged.kind === "not-found"
        ? `No Workroom is live and the trunk carries no standing commit that delivered ${item.itemId}. A post-implementation review reviews merged work; merge the repair first.`
        : "No Workroom is live and the merge-through-gates signal could not read the trunk here, so the merged repair cannot be identified. Point DPF_HOST_SOURCE_ROOT at a source checkout, then retry." };
  }
  const commits = (merged.kind === "found" ? [merged.commit] : merged.commits)
    .map((commit) => ({ sha: commit.sha, parentSha: commit.parentSha }));
  const newest = commits[commits.length - 1]!;
  const { loadItemDeliveryActorIds } = await import("@/lib/backlog/acceptance-sweep/delivery-actors");
  const actors = await loadItemDeliveryActorIds(prisma as never, item.itemId);
  if (!actors.ok) {
    return { kind: "unavailable", reason: "delivery-actors-unbounded",
      nextAction: `${actors.error} A post-merge review is routed only when every delivery actor can be excluded from reviewing it.` };
  }
  return {
    kind: "found",
    room: { capsuleId: room.capsuleId, backlogItemId: room.backlogItemId, repositoryFullName: room.repositoryFullName,
      baseSha: room.baseSha ?? commits[0]!.parentSha, headBranch: room.headBranch, headSha: room.headSha ?? newest.sha, isLive: false },
    mergedCommitSha: newest.sha,
    parentSha: newest.parentSha,
    commits,
    deliveryActorIds: actors.data,
  };
}
