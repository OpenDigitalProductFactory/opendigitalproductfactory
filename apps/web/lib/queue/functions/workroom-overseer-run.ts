// The overseer duty's reads and writes (BI-8E1486FA). The rules are pure, in
// lib/work-management/workroom-overseer-duty.ts; the drive cycle calls
// runOverseerDuty before it drives rooms (workroom-drive.ts).
//
// Writers are the governed ones that already exist and nothing else:
//   - close: releaseWorkCapsuleScope, then updateWorkCapsuleStatus(archived),
//     the delivered close-out the reaper and the publication refusal name;
//   - route/clear: a compare-and-set of workspaceState.workroomOverseer, read
//     by the workroom-stall attention source, plus a trail row.
// Merge state is read the way the reaper reads it: the latest verified GitHub
// observation, then positive local trunk reachability. Unknown never closes.

import { isRecord } from "@/lib/shared/coerce";
import { parseScopeClaims } from "@/lib/work-capsules";
import { authoredHeadSha } from "@/lib/work-capsules/authored-head";
import type { CapsuleDb, WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import type { ReaperCapsuleRow } from "@/lib/work-capsules/work-capsule-reaper";
import { readDeclaredWorkShapeKey } from "@/lib/work-management/work-shapes";
import { readDriveHold } from "@/lib/work-management/workroom-drive-hold";
import {
  emptyOverseerSummary,
  formatOverseerSummary,
  planOverseerDuty,
  readOverseerState,
  WORKROOM_OVERSEER_ACTIVITY_KIND,
  type OverseerAction,
  type OverseerCycleSummary,
  type OverseerRoom,
  type OverseerState,
} from "@/lib/work-management/workroom-overseer-duty";

export const OVERSEER_DRY_RUN_FLAG = "DPF_WORKROOM_OVERSEER_DRY_RUN";

const OVERSEER_ACTOR: WorkCapsuleActor = { userId: "system:workroom-overseer", agentId: null, principalId: null };
const TERMINAL_ROOM_STATUSES = ["complete", "abandoned", "archived"];

export type OverseerEffects = {
  /** Close a room through the governed writers. False when a writer refused; the next cycle retries. */
  close: (action: Extract<OverseerAction, { kind: "close" }>, now: Date) => Promise<boolean>;
  /** Compare-and-set the room's overseer state and add its trail row. False on a lost race. */
  record: (action: Exclude<OverseerAction, { kind: "close" }>, now: Date) => Promise<boolean>;
};

/**
 * One cycle: read, plan, apply, summarize. A failure on one room is counted as
 * refused and the cycle goes on, as the drive does for its own rooms.
 */
export async function runOverseerDuty(input: {
  now: Date;
  dryRun: boolean;
  loadRooms: () => Promise<OverseerRoom[]>;
  effects: OverseerEffects;
  log?: (line: string) => void;
}): Promise<OverseerCycleSummary> {
  const rooms = await input.loadRooms();
  const actions = planOverseerDuty(rooms, input.now);
  const summary = emptyOverseerSummary(input.dryRun, rooms.filter((room) => room.inScan).length);
  for (const action of actions) {
    if (action.kind === "clear") summary.cleared += 1;
    else summary.fired[action.rule] += 1;
    if (input.dryRun) continue;
    try {
      const applied = action.kind === "close" ? await input.effects.close(action, input.now) : await input.effects.record(action, input.now);
      if (!applied) summary.refused += 1;
      else if (action.kind === "close") summary.closedRoomIds.push(action.room.id);
    } catch (error) {
      summary.refused += 1;
      console.warn(`[workroom-overseer] ${action.rule} on ${action.room.capsuleId} refused; retried next cycle:`, error);
    }
  }
  (input.log ?? console.info)(formatOverseerSummary(summary));
  return summary;
}

type RoomRow = {
  id: string; capsuleId: string; title: string; status: string; source: string; executorKind: string | null;
  idempotencyKey: string | null; scopeClaims: unknown; workspaceState: unknown; backlogItemId: string | null;
  leaseExpiresAt: Date | null; lastSyncedAt: Date | null; updatedAt: Date;
  repositoryFullName: string | null; headBranch: string | null; headSha: string | null; baseSha: string | null;
  pullRequestNumber: number | null; pullRequestUrl: string | null; worktreePath: string | null; featureBuildId: string | null;
  participants?: Array<{ roles: string[]; principal: { principalId: string } }>;
};

const ROOM_SELECT = {
  id: true, capsuleId: true, title: true, status: true, source: true, executorKind: true, idempotencyKey: true,
  scopeClaims: true, workspaceState: true, backlogItemId: true, leaseExpiresAt: true, lastSyncedAt: true, updatedAt: true,
  repositoryFullName: true, headBranch: true, headSha: true, baseSha: true, pullRequestNumber: true, pullRequestUrl: true,
  worktreePath: true, featureBuildId: true,
  participants: { where: { lifecycle: "active" }, select: { roles: true, principal: { select: { principalId: true } } } },
} as const;

/** The room's Process Overseer as conformance recorded it, else its coordinator, else its accountable participant. */
export function overseerAssigneeOf(row: Pick<RoomRow, "workspaceState" | "participants">): string | null {
  const drive = isRecord(row.workspaceState) && isRecord(row.workspaceState.workroomDrive) ? row.workspaceState.workroomDrive : null;
  const recorded = isRecord(drive?.conformance) ? drive.conformance.processOverseerPrincipalRef : null;
  if (typeof recorded === "string" && recorded.length > 0) return recorded;
  for (const role of ["coordinator", "accountable"]) {
    const found = row.participants?.find((participant) => participant.roles.includes(role));
    if (found) return found.principal.principalId;
  }
  return null;
}

type ItemRow = { id: string; itemId: string; status: string; effortSize: string | null };

/** Pure: one loaded row, its item and its merge annotation, as the planner reads it. */
export function toOverseerRoom(row: RoomRow, item: ItemRow | null, merge: Pick<ReaperCapsuleRow, "deliveredSignal" | "pullRequestObservation">, inScan: boolean): OverseerRoom {
  const drive = isRecord(row.workspaceState) && isRecord(row.workspaceState.workroomDrive) ? row.workspaceState.workroomDrive : null;
  return {
    id: row.id, capsuleId: row.capsuleId, status: row.status, idempotencyKey: row.idempotencyKey,
    shapeKey: readDeclaredWorkShapeKey(row.scopeClaims),
    itemKey: item?.itemId ?? row.backlogItemId, itemStatus: item?.status ?? null, itemEffortSize: item?.effortSize ?? null,
    leaseExpiresAt: row.leaseExpiresAt,
    merged: merge.deliveredSignal ? merge.deliveredSignal.merged : null,
    openPullRequest: merge.pullRequestObservation?.state === "open",
    pullRequestNumber: row.pullRequestNumber,
    authoredHead: authoredHeadSha(row) !== null,
    hold: readDriveHold(row.workspaceState),
    driveAction: typeof drive?.action === "string" ? drive.action : null,
    driveReason: typeof drive?.reason === "string" ? drive.reason : null,
    assigneePrincipalRef: overseerAssigneeOf(row),
    overseer: readOverseerState(row.workspaceState),
    inScan,
  };
}

type OverseerDb = CapsuleDb & {
  backlogItem: { findMany(args: unknown): Promise<ItemRow[]> } & NonNullable<CapsuleDb["backlogItem"]>;
  workroom: CapsuleDb["workroom"] & { updateMany(args: unknown): Promise<{ count: number }> };
  $transaction<T>(fn: (tx: OverseerDb) => Promise<T>): Promise<T>;
};

/**
 * The drive's rooms, plus every other live room for the same items (R5 counts
 * them; they are never acted on). Bounded by the drive's own scan.
 */
export async function loadOverseerRooms(db: OverseerDb, roomIds: readonly string[], now: Date): Promise<OverseerRoom[]> {
  if (roomIds.length === 0) return [];
  const scanned = (await db.workroom.findMany({ where: { id: { in: [...roomIds] } }, select: ROOM_SELECT })) as RoomRow[];
  const keys = [...new Set(scanned.map((row) => row.backlogItemId).filter((key): key is string => Boolean(key)))];
  const items = keys.length === 0 ? [] : await db.backlogItem.findMany({
    where: { OR: [{ id: { in: keys } }, { itemId: { in: keys } }] }, select: { id: true, itemId: true, status: true, effortSize: true },
  });
  const itemByKey = new Map<string, ItemRow>();
  for (const item of items) { itemByKey.set(item.id, item); itemByKey.set(item.itemId, item); }
  const itemKeys = [...new Set(items.flatMap((item) => [item.id, item.itemId]))];
  const siblings = itemKeys.length === 0 ? [] : (await db.workroom.findMany({
    where: { backlogItemId: { in: itemKeys }, id: { notIn: [...roomIds] }, archivedAt: null, status: { notIn: TERMINAL_ROOM_STATUSES } },
    select: ROOM_SELECT, take: 200,
  })) as RoomRow[];

  const rows = [...scanned.map((row) => ({ row, inScan: true })), ...siblings.map((row) => ({ row, inScan: false }))];
  const annotated: ReaperCapsuleRow[] = rows.map(({ row }) => ({ ...row, deliveredSignal: null, pullRequestObservation: null }));
  const { annotateDeliveredSignals, annotateProviderDeliverySignals, loadLatestSuccessfulProviderPayloads } = await import("@/lib/work-capsules/work-capsule-reaper");
  const provider = await loadLatestSuccessfulProviderPayloads(db as never);
  await annotateProviderDeliverySignals(annotated, provider.payloads, now, provider.confirmedAt);
  await annotateDeliveredSignals(annotated);
  return rows.map(({ row, inScan }, index) =>
    toOverseerRoom(row, row.backlogItemId ? itemByKey.get(row.backlogItemId) ?? null : null, annotated[index]!, inScan));
}

export function createOverseerEffects(loadDb: () => Promise<OverseerDb>): OverseerEffects {
  return {
    async close(action, now) {
      const db = await loadDb();
      const current = await db.workroom.findUnique({ where: { id: action.room.id } });
      if (!current || TERMINAL_ROOM_STATUSES.includes(current.status)) return false;
      const claims = parseScopeClaims(current.scopeClaims).map(({ kind, value }) => ({ kind, value }));
      const { releaseWorkCapsuleScope, updateWorkCapsuleStatus } = await import("@/lib/work-capsules/work-capsule-store");
      if (claims.length > 0) {
        await releaseWorkCapsuleScope({ db, capsuleId: action.room.capsuleId, claims, actor: OVERSEER_ACTOR, now });
      }
      await updateWorkCapsuleStatus({ db, capsuleId: action.room.capsuleId, status: "archived", reason: action.summary, actor: OVERSEER_ACTOR, now });
      publish(action.room.id, await writeTrailRow(db, action, { ...action.facts, releasedClaims: claims.length, status: "archived" }));
      return true;
    },
    async record(action) {
      const db = await loadDb();
      const written = await db.$transaction(async (raw): Promise<string | null> => {
        const tx = raw as OverseerDb;
        const current = await tx.workroom.findUnique({ where: { id: action.room.id }, select: { workspaceState: true, updatedAt: true, status: true } });
        if (!current || TERMINAL_ROOM_STATUSES.includes(current.status)) return null;
        // Re-read, then compare: a cycle that raced another writer leaves this for the next one.
        if (JSON.stringify(readOverseerState(current.workspaceState)) !== JSON.stringify(action.room.overseer)) return null;
        const state = isRecord(current.workspaceState) ? current.workspaceState : {};
        const next: OverseerState = action.next;
        const updated = await tx.workroom.updateMany({
          where: { id: action.room.id, updatedAt: current.updatedAt },
          data: { workspaceState: { ...state, workroomOverseer: next } as object },
        });
        if (updated.count !== 1) return null;
        return writeTrailRow(tx, action, action.facts);
      });
      if (written) publish(action.room.id, written);
      return written !== null;
    },
  };
}

async function writeTrailRow(db: CapsuleDb, action: OverseerAction, facts: Record<string, unknown>): Promise<string | null> {
  const activity = await db.workroomActivity.create({
    data: {
      workCapsuleId: action.room.id, kind: WORKROOM_OVERSEER_ACTIVITY_KIND, summary: action.summary,
      payload: { rule: action.rule, action: action.kind, facts } as object,
      recordedById: OVERSEER_ACTOR.userId, recordedByAgentId: null,
    },
  });
  return typeof activity?.id === "string" ? activity.id : null;
}

function publish(roomId: string, activityId: string | null): void {
  // Realtime is advisory; the trail row is already written.
  void import("@/lib/work-capsules/activity-events")
    .then(({ publishRecordedWorkCapsuleActivity }) => publishRecordedWorkCapsuleActivity(roomId, activityId))
    .catch(() => undefined);
}

/** The live cycle the drive runs: its own room ids, the live database, the env dry-run switch. */
export async function runLiveOverseerDuty(roomIds: readonly string[], now: Date): Promise<OverseerCycleSummary> {
  const loadDb = async () => (await import("@dpf/db")).prisma as unknown as OverseerDb;
  return runOverseerDuty({
    now,
    dryRun: process.env[OVERSEER_DRY_RUN_FLAG] === "1",
    loadRooms: async () => loadOverseerRooms(await loadDb(), roomIds, now),
    effects: createOverseerEffects(loadDb),
  });
}

/**
 * The drive's call: run the duty over the rooms it is about to drive. A failed
 * duty is logged and the tick drives every room exactly as before it existed.
 */
export async function runDriveOverseer(
  rooms: readonly { id: string }[],
  now: Date,
  run: (roomIds: readonly string[], now: Date) => Promise<OverseerCycleSummary> = runLiveOverseerDuty,
): Promise<OverseerCycleSummary | null> {
  try {
    return await run(rooms.map((room) => room.id), now);
  } catch (error) {
    console.warn("[workroom-overseer] cycle failed; the drive continues without it:", error);
    return null;
  }
}

export type DriveOverseerDeps = {
  /** BI-8E1486FA: the overseer duty over a tick's room ids. Defaults to the live duty; caller-supplied rooms skip it. */
  overseer?: (roomIds: readonly string[], now: Date) => Promise<OverseerCycleSummary>;
};

export type DriveOverseerResult = {
  /** BI-8E1486FA: what the per-room overseer duty did this tick; absent when it did not run. */
  overseer?: OverseerCycleSummary | null;
};

/** The drive's rooms minus those the duty closed, so a closed room is not planned in the same tick. */
export async function overseeDriveRooms<R extends { id: string }>(
  rooms: R[],
  now: Date,
  deps: (DriveOverseerDeps & { listRooms?: unknown }) | undefined,
): Promise<{ rooms: R[]; overseer: OverseerCycleSummary | null }> {
  if (deps && !deps.overseer && deps.listRooms) return { rooms, overseer: null };
  const overseer = await runDriveOverseer(rooms, now, deps?.overseer);
  return { rooms: overseer ? rooms.filter((room) => !overseer.closedRoomIds.includes(room.id)) : rooms, overseer };
}
