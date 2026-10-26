import type { Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { isDirectMergePlatformWork } from "@/lib/backlog/initiative-readiness/backlog-completion-evaluation";
import { mergeSignalRoots } from "@/lib/backlog/initiative-readiness/merge-delivery-signal";
import { BACKLOG_COMPLETION_ITEM_SELECT } from "@/lib/backlog/initiative-readiness/backlog-completion-evaluation";
import { readBoundEditPaths, readBoundWorkShapeRef } from "@/lib/backlog/initiative-readiness/bound-work-shape";
import { assessDeliverySensitivity } from "@/lib/backlog/initiative-readiness/delivery-sensitivity";
import { readinessShapeFromWorkShape } from "@/lib/backlog/initiative-readiness/entry-adapter";
import { effectiveShape } from "@/lib/backlog/initiative-readiness/shape-requirements";
import { resolveBacklogDeploymentClosure } from "@/lib/backlog/initiative-readiness/deployment-closure";
import { SMALL_ACCEPTANCE_KEY, readSmallAcceptanceBinding, sameSmallAcceptanceContext, type SmallAcceptanceContext, type RetainedSmallCheck } from "./small-acceptance-binding";

export type SmallAcceptanceDb = Prisma.TransactionClient;

/** Current server facts only. The caller supplies locators, never source or authority. */
export async function loadSmallAcceptanceContext(args: {
  db: SmallAcceptanceDb; workCapsuleId: string; closureId: string; lock?: boolean;
}): Promise<SmallAcceptanceContext> {
  const { db } = args;
  // All writers serialize behind the same persisted quiescence row, before item locks.
  if (args.lock) await db.$queryRawUnsafe('SELECT "key" FROM "PlatformConfig" WHERE "key" = $1 FOR SHARE', "portal.quiescence");
  const quiescence = await db.platformConfig.findUnique({ where: { key: "portal.quiescence" } });
  if (!isRecord(quiescence?.value) || quiescence.value.level !== "normal") throw new Error("Canonical runtime is not proven normal.");
  const room = await db.workroom.findUnique({ where: { id: args.workCapsuleId } });
  if (!room?.backlogItemId) throw new Error("The verification Workroom has no item.");
  const item = await db.backlogItem.findFirst({ where: { OR: [{ id: room.backlogItemId }, { itemId: room.backlogItemId }] }, select: BACKLOG_COMPLETION_ITEM_SELECT });
  if (!item || item.status !== "done" || !isDirectMergePlatformWork(item)) throw new Error("A delivered direct platform item is required.");
  if (args.lock) {
    await db.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', item.id);
    await db.$queryRawUnsafe('SELECT "id" FROM "WorkCapsule" WHERE "id" = $1 FOR SHARE', room.id);
  }
  const currentItem = await db.backlogItem.findUnique({ where: { id: item.id }, select: BACKLOG_COMPLETION_ITEM_SELECT });
  if (!currentItem || currentItem.status !== "done") throw new Error("Delivery changed while binding acceptance.");
  const shape = readinessShapeFromWorkShape(await readBoundWorkShapeRef(db, item.itemId));
  const sensitivity = assessDeliverySensitivity({ ...currentItem, declaredPaths: await readBoundEditPaths(db, item.itemId) });
  if (shape !== "small" || effectiveShape(shape, sensitivity.level, "fix", item.workType) !== "small") throw new Error("This evidence lane requires effective Small work.");
  const closure = await db.backlogItemActivity.findFirst({ where: { backlogItemId: item.id, kind: "status_change" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
  const payload = isRecord(closure?.payload) ? closure.payload : null;
  if (!closure || closure.id !== args.closureId || payload?.to !== "done" || payload.closureBasis !== "canonical-deployment"
    || !isRecord(payload.deployment)) throw new Error("The exact current canonical closure is required.");
  const original = payload.deployment;
  const deployment = await resolveBacklogDeploymentClosure({ itemId: item.itemId, workType: item.workType, roots: mergeSignalRoots(), db });
  if (deployment.kind !== "deployed" || deployment.repositoryFullName !== room.repositoryFullName
    || deployment.headSha !== room.headSha || deployment.pullRequestNumber !== room.pullRequestNumber
    || deployment.headSha !== original.headSha || deployment.mergeCommitSha !== original.mergeCommitSha
    || deployment.repositoryFullName !== original.repositoryFullName) throw new Error("Current served deployment does not prove this delivered change.");
  if (args.lock) await db.$queryRawUnsafe('SELECT "id" FROM "SelfUpgradeRun" WHERE "runId" = $1 FOR SHARE', deployment.runId);
  return { itemId: item.itemId, closureId: closure.id, workCapsuleId: room.id,
    repositoryFullName: deployment.repositoryFullName, headSha: deployment.headSha,
    mergeCommitSha: deployment.mergeCommitSha, servedSha: deployment.servedSha,
    deploymentRunId: deployment.runId, deploymentCompletedAt: deployment.completedAt,
    effectiveShape: "small", closureRecordedAt: closure.recordedAt.toISOString() };
}

/** No history backfill. Only records created by the reserved native writer qualify. */
export async function readRetainedSmallCheck(db: SmallAcceptanceDb, itemId: string): Promise<RetainedSmallCheck> {
  const missing: RetainedSmallCheck = { state: "missing", evidenceRefs: [] };
  const item = await db.backlogItem.findUnique({ where: { itemId }, select: { id: true } });
  if (!item) return missing;
  const closure = await db.backlogItemActivity.findFirst({ where: { backlogItemId: item.id, kind: "status_change" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
  if (!closure) return missing;
  const room = await db.workroom.findFirst({ where: { backlogItemId: { in: [itemId, item.id] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  if (!room) return missing;
  // Use the capsule/kind index. Later unbound failures conservatively veto an older pass.
  const rows = await db.runtimeVerification.findMany({ where: { workCapsuleId: room.id, kind: "final-acceptance",
    createdAt: { gte: closure.recordedAt }, status: { in: ["passed", "failed"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
  if (rows.length > 100) return missing;
  const checkTime = (row: (typeof rows)[number]) => {
    const binding = readSmallAcceptanceBinding(isRecord(row.result) ? row.result[SMALL_ACCEPTANCE_KEY] : null);
    return binding ? Date.parse(binding.completedAt) : row.createdAt.getTime();
  };
  rows.sort((a, b) => checkTime(b) - checkTime(a) || (a.status === b.status ? 0 : a.status === "failed" ? -1 : 1));
  for (const row of rows) {
    const binding = readSmallAcceptanceBinding(isRecord(row.result) ? row.result[SMALL_ACCEPTANCE_KEY] : null);
    if (!binding && row.status === "failed") return { state: "fail", evidenceRefs: [row.id] };
    if (!binding || !row.workCapsuleId || binding.itemId !== itemId || binding.closureId !== closure.id
      || binding.workCapsuleId !== row.workCapsuleId || row.startedAt?.toISOString() !== binding.startedAt
      || row.completedAt?.toISOString() !== binding.completedAt || row.createdAt.getTime() < Date.parse(binding.recordedAt)) continue;
    try {
      const context = await loadSmallAcceptanceContext({ db, closureId: closure.id, workCapsuleId: row.workCapsuleId });
      if (!sameSmallAcceptanceContext(binding, context)) continue;
      // Re-read after provider/lineage work; a changed closure cannot inherit this check.
      const latest = await db.backlogItemActivity.findFirst({ where: { backlogItemId: item.id, kind: "status_change" },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { id: true } });
      if (latest?.id !== closure.id) return missing;
      if (row.status === "passed") {
        const laterFailure = await db.backlogItemActivity.findFirst({ where: {
          backlogItemId: item.id, kind: "evidence", recordedAt: { gte: row.completedAt! },
          OR: [{ payload: { path: ["evidenceKind"], equals: "manual_fail" } },
            { payload: { path: ["evidenceKind"], equals: "ux_fail" } }],
        }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { id: true } });
        if (laterFailure) return { state: "fail", evidenceRefs: [laterFailure.id] };
      }
      return { state: row.status === "passed" ? "pass" : "fail", evidenceRefs: [row.id] };
    } catch { return missing; }
  }
  return missing;
}

/** Reuse canonical completion and the sweep's retained projector after commit. */
export async function refreshSmallAcceptanceSnapshot(db: SmallAcceptanceDb, itemId: string): Promise<void> {
  const item = await db.backlogItem.findUnique({ where: { itemId }, select: BACKLOG_COMPLETION_ITEM_SELECT });
  if (!item || item.status !== "done" || !isDirectMergePlatformWork(item)) return;
  const { evaluateBacklogItemCompletion } = await import("@/lib/backlog/initiative-readiness/backlog-completion-evaluation");
  const { retainedAcceptanceWithoutBinding } = await import("@/lib/backlog/acceptance-sweep/retained-acceptance");
  const { loadItemDeliveryActorIds } = await import("@/lib/backlog/acceptance-sweep/delivery-actors");
  const { recordOwedAcceptanceSnapshot } = await import("@/lib/backlog/acceptance-sweep/owed-snapshot");
  const actors = await loadItemDeliveryActorIds(db as unknown as Parameters<typeof loadItemDeliveryActorIds>[0], itemId);
  if (!actors.ok) throw new Error(`Delivery actors could not be read: ${actors.error}`);
  const evaluation = await evaluateBacklogItemCompletion({ db: db as unknown as Parameters<typeof evaluateBacklogItemCompletion>[0]["db"],
    item, rawManifest: undefined, evaluatedAt: new Date().toISOString(),
    transitionObject: { kind: "backlog-item", id: itemId, expectedVersion: "done", targetState: "completion" } });
  const projection = retainedAcceptanceWithoutBinding(evaluation.independentAcceptanceDecision, actors.data,
    await readRetainedSmallCheck(db, itemId));
  await recordOwedAcceptanceSnapshot({ db: db as unknown as Parameters<typeof recordOwedAcceptanceSnapshot>[0]["db"], backlogItemId: item.id, projection });
}
