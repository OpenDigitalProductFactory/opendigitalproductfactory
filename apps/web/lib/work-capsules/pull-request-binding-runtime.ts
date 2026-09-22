import { isRecord } from "@/lib/shared/coerce";
import { parseVerifiedPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { WORK_CAPSULE_OPEN_PR_FRESHNESS_MS } from "./liveness";
import { resolvePullRequestBindings } from "./pull-request-binding";

const BATCH_LIMIT = 100;
const SNAPSHOT_LIMIT = 1000;

/** Observe only. The existing inventory owns provider reads and scheduling. */
export async function reconcileInventoryPullRequestBindings(syncRunId: string, now = new Date()) {
  const { prisma } = await import("@dpf/db");
  const result = { bound: 0, compareAndSwapLost: 0, skipped: 0, invalidObservations: 0, hasMore: false, reason: "observed" };
  const run = await prisma.contributorInventorySyncRun.findUnique({
    where: { syncRunId }, select: { completedAt: true, perSourceResult: true },
  });
  const summary = isRecord(run?.perSourceResult) ? run.perSourceResult["github-pr"] : null;
  const source = isRecord(summary) ? summary : {};
  const age = run?.completedAt ? now.getTime() - run.completedAt.getTime() : Infinity;
  if (source.ok !== true || age < 0 || age > WORK_CAPSULE_OPEN_PR_FRESHNESS_MS) {
    return { ...result, reason: "source-unconfirmed" };
  }
  const snapshotRunId = typeof source.snapshotRunId === "string" ? source.snapshotRunId : syncRunId;
  const snapshots = await prisma.contributorInventorySnapshot.findMany({
    where: { syncRunId: snapshotRunId, source: "github-pr" },
    select: { payload: true }, orderBy: { sourceKey: "asc" }, take: SNAPSHOT_LIMIT + 1,
  });
  if (snapshots.length > SNAPSHOT_LIMIT) return { ...result, hasMore: true, reason: "snapshot-limit" };
  const observations = snapshots.flatMap(({ payload }) => {
    const observation = parseVerifiedPullRequestObservation(payload);
    return observation ? [observation] : [];
  });
  result.invalidObservations = snapshots.length - observations.length;
  if (!observations.length) return { ...result, reason: "no-observations" };
  const rooms = await prisma.workroom.findMany({
    where: {
      archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] },
      OR: observations.map((observation) => ({
          repositoryFullName: observation.repositoryFullName, headBranch: observation.headBranch,
          AND: [
            { OR: [{ headSha: observation.headSha }, { headSha: null, AND: [
              { OR: [{ pullRequestNumber: null }, { pullRequestNumber: observation.number }] },
              { OR: [{ pullRequestUrl: null }, { pullRequestUrl: observation.url }] },
            ] }] },
            { OR: [{ pullRequestNumber: null }, { pullRequestUrl: null },
              { pullRequestNumber: { not: observation.number } }, { pullRequestUrl: { not: observation.url } }] },
          ],
        })),
    },
    select: { id: true, capsuleId: true, repositoryFullName: true, headBranch: true,
      headSha: true, pullRequestNumber: true, pullRequestUrl: true, updatedAt: true },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: BATCH_LIMIT + 1,
  });
  result.hasMore = rooms.length > BATCH_LIMIT;
  const batch = rooms.slice(0, BATCH_LIMIT);
  const plan = resolvePullRequestBindings({ rooms: batch, observations });
  result.skipped = plan.skipped.length;
  for (const binding of plan.bindings) {
    const room = batch.find((candidate) => candidate.capsuleId === binding.capsuleId)!;
    const observation = observations.find((candidate) => candidate.repositoryFullName === room.repositoryFullName
      && candidate.headBranch === room.headBranch && candidate.number === binding.pullRequestNumber
      && (!room.headSha || candidate.headSha.toLowerCase() === room.headSha.toLowerCase()))!;
    const saved = await prisma.$transaction(async (tx) => {
      const update = await tx.workroom.updateMany({
        where: { id: room.id, updatedAt: room.updatedAt, archivedAt: null,
          repositoryFullName: room.repositoryFullName, headBranch: room.headBranch, headSha: room.headSha,
          pullRequestNumber: room.pullRequestNumber, pullRequestUrl: room.pullRequestUrl },
        data: { pullRequestNumber: binding.pullRequestNumber, pullRequestUrl: binding.pullRequestUrl },
      });
      if (update.count !== 1) return false;
      await tx.workroomActivity.create({ data: {
        workCapsuleId: room.id, kind: "evidence",
        summary: `Observed pull request #${binding.pullRequestNumber} (${binding.state}); linked repository and branch.`,
        payload: { syncRunId, snapshotRunId, repositoryFullName: observation.repositoryFullName,
          pullRequestNumber: observation.number, pullRequestUrl: observation.url,
          previousPullRequestNumber: room.pullRequestNumber, previousPullRequestUrl: room.pullRequestUrl,
          headSha: observation.headSha, state: observation.state,
          observationFingerprint: observation.observationFingerprint, confirmedAt: run!.completedAt!.toISOString() },
      } });
      return true;
    });
    if (saved) result.bound += 1;
    else result.compareAndSwapLost += 1;
  }
  return result;
}
