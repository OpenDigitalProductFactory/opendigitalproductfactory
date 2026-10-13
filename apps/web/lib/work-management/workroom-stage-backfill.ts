/**
 * One-time replay of the drive log into stage telemetry (BI-4ADFFEDB, EP-B70E718D F2).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §6 "Backfill".
 *
 * The drive has written a trail row on every state change for months. Replaying
 * those rows through the same planner the live drive now uses gives stage
 * history from day one, so trends start with data rather than empty.
 *
 * - Runs inside the platform (the queue aggregator calls it), never as a
 *   hand-run script: platform function does not depend on a client.
 * - Idempotent: replayed rows carry the replay's versioned actorId; when any
 *   exist the replay does nothing. A new version (the planner learned to see
 *   something the last replay dropped) first removes the rows an earlier
 *   version wrote. They are derived from the drive log, which is untouched, so
 *   replacing them loses nothing.
 * - Never double counts: a version replays the drive log up to the moment it
 *   runs and replaces every stage row before that moment, live ones included.
 *   Every stage row is derived from the drive trail (the drive writes a trail
 *   row on each state change and emits from it), so the trail rebuilds them
 *   under the planner as it is now; rows written after that moment are kept.
 * - Resolution is the drive tick, and the shape is the room's current claim.
 *   Both are stated limitations; live events after deploy have neither.
 * - Past days are re-aggregated for `wr:` queues only, with no live counts, so
 *   no other queue's history is touched. The day's events are read for stage
 *   items only, in the query: the event table carries ~700k other rows a day.
 * - Bounded memory (the portal's heap is ~1.5 GB, BI-927FF076): rooms are
 *   replayed a page at a time, each drive row carries only the fields the
 *   planner reads, and a page is inserted before the next is read. Pages land
 *   under a staging actor that becomes the final one only after the last page,
 *   so a run that dies part-way is not mistaken for a finished one; the next
 *   run clears it and starts again.
 */
import { aggregateQueueMetrics, type QueueTelemetryRow, type RollupDeps } from "@/lib/queue/queue-metrics-rollup";

import { readWorkShapeClaimRef } from "./workroom-shape-claim";
import {
  WORKROOM_STAGE_ITEM_KIND,
  WORKROOM_STAGE_QUEUE_PREFIX,
  openStageAfter,
  planStageTransitions,
  readDriveObservation,
  type StageTransition,
} from "./workroom-stage-telemetry";

/**
 * v2: holds raised before a room entered any stage are placed at the shape's
 * first stage, and conformance causes are read from the drive ledger. v1
 * dropped both, so the 2026-09-23 pile of rooms paused on
 * missing_explicit_coordinator never appeared.
 */
/**
 * v3: a finite room is one run (its daily cycle stamp no longer opens a new
 * item each day), and a recurring cycle still open when the next begins is
 * cancelled rather than finished as a success. v2 and every live row before
 * it read each day's rollover as a completed run, so flow time sat at ~24h in
 * every portfolio and throughput counted day boundaries.
 */
export const STAGE_BACKFILL_ACTOR = "backfill:drive-log:v3";
/** Every replay version, current and superseded. */
export const STAGE_BACKFILL_ACTOR_PREFIX = "backfill:drive-log";
/** Rows of a replay still in progress; renamed to the final actor when it completes. */
export const STAGE_BACKFILL_STAGING_ACTOR = `${STAGE_BACKFILL_ACTOR}:partial`;
/** Rooms replayed per page: one page's drive trails are all the replay holds. */
export const STAGE_BACKFILL_ROOM_PAGE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DriveLogRoom = {
  capsuleId: string;
  scopeClaims: unknown;
  /** Drive trail rows, any order. `payload` is the drive snapshot of that tick. */
  rows: readonly { recordedAt: Date; payload: unknown }[];
};

/** Pure: replay each room's trail, oldest first, through the live planner. */
export function replayDriveLog(rooms: readonly DriveLogRoom[], until: Date): StageTransition[] {
  const out: StageTransition[] = [];
  for (const room of rooms) {
    const shapeRef = readWorkShapeClaimRef(room.scopeClaims);
    if (!shapeRef) continue;
    const ordered = [...room.rows]
      .filter((row) => row.recordedAt.getTime() < until.getTime())
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    let prior = null as ReturnType<typeof readDriveObservation>;
    let openStageKey: string | null = null;
    for (const row of ordered) {
      const next = readDriveObservation({ workroomDrive: row.payload });
      if (!next) continue;
      const planned = planStageTransitions({ capsuleId: room.capsuleId, shapeRef, prior, next, at: row.recordedAt, openStageKey });
      out.push(...planned);
      openStageKey = openStageAfter(openStageKey, planned);
      prior = next;
    }
  }
  return out;
}

export type StageBackfillDeps = {
  alreadyBackfilled: () => Promise<boolean>;
  /**
   * Remove every stage row before `until` that this version did not write:
   * earlier or unfinished replays, and live rows the replay rebuilds. Returns
   * the days they covered.
   */
  clearReplaced: (until: Date) => Promise<string[]>;
  /** Rooms with drive rows in the window, without their rows. */
  listDriveLogRooms: (since: Date, until: Date) => Promise<string[]>;
  /** The drive trails of these rooms, each row reduced to what the planner reads. */
  loadDriveLog: (capsuleIds: readonly string[], since: Date, until: Date) => Promise<DriveLogRoom[]>;
  insert: (rows: readonly (StageTransition & { actorId: string })[]) => Promise<number>;
  /** Rename the staging rows to the final actor: the replay is complete. */
  commit: () => Promise<void>;
  /** Re-aggregate one past day for `wr:` queues only. */
  aggregateDay: (at: Date) => Promise<void>;
  now: () => Date;
};

export type StageBackfillResult =
  | { ran: false; reason: "already-backfilled" }
  | { ran: true; transitions: number; days: number; until: string };

export async function backfillWorkroomStageTelemetry(
  deps: StageBackfillDeps,
  options: { lookbackDays?: number } = {},
): Promise<StageBackfillResult> {
  if (await deps.alreadyBackfilled()) return { ran: false, reason: "already-backfilled" };
  const now = deps.now();
  // The event table keeps 90 days; replaying further back is swept at once.
  const since = new Date(now.getTime() - (options.lookbackDays ?? 90) * DAY_MS);
  const until = now;
  const days = new Set(await deps.clearReplaced(until));
  const rooms = await deps.listDriveLogRooms(since, until);
  let inserted = 0;
  for (let i = 0; i < rooms.length; i += STAGE_BACKFILL_ROOM_PAGE) {
    const transitions = replayDriveLog(await deps.loadDriveLog(rooms.slice(i, i + STAGE_BACKFILL_ROOM_PAGE), since, until), until);
    inserted += await deps.insert(transitions.map((t) => ({ ...t, actorId: STAGE_BACKFILL_STAGING_ACTOR })));
    for (const t of transitions) days.add(t.occurredAt.toISOString().slice(0, 10));
  }
  await deps.commit();

  for (const day of [...days].sort()) await deps.aggregateDay(new Date(`${day}T12:00:00.000Z`));
  return { ran: true, transitions: inserted, days: days.size, until: until.toISOString() };
}

/** Deps bound to the live Prisma client. */
export async function defaultStageBackfillDeps(): Promise<StageBackfillDeps> {
  const { prisma, Prisma } = await import("@dpf/db");
  const { defaultRollupDeps } = await import("@/lib/queue/queue-metrics-rollup");
  const rollup = await defaultRollupDeps();
  const stageOnly: RollupDeps = {
    ...rollup,
    // Stage rows only, in the query: the day holds ~700k rows of other queues.
    fetchEvents: async (start, end) =>
      (await prisma.queueTelemetryEvent.findMany({
        where: { itemKind: WORKROOM_STAGE_ITEM_KIND, queueKey: { startsWith: WORKROOM_STAGE_QUEUE_PREFIX }, occurredAt: { gte: start, lt: end } },
        select: { queueKey: true, itemKind: true, itemId: true, transition: true, outcome: true, occurredAt: true, laneKey: true },
      })) as QueueTelemetryRow[],
    fetchLiveCounts: async () => new Map(),
  };
  return {
    alreadyBackfilled: async () =>
      (await prisma.queueTelemetryEvent.findFirst({
        where: { itemKind: WORKROOM_STAGE_ITEM_KIND, actorId: STAGE_BACKFILL_ACTOR },
        select: { id: true },
      })) !== null,
    clearReplaced: async (until) => {
      const where = {
        itemKind: WORKROOM_STAGE_ITEM_KIND,
        occurredAt: { lt: until },
        OR: [{ actorId: null }, { actorId: { not: STAGE_BACKFILL_ACTOR } }],
      };
      const rows = await prisma.queueTelemetryEvent.findMany({ where, select: { occurredAt: true } });
      await prisma.queueTelemetryEvent.deleteMany({ where });
      return [...new Set(rows.map((row) => row.occurredAt.toISOString().slice(0, 10)))];
    },
    listDriveLogRooms: async (since, until) => {
      const rows = await prisma.$queryRaw<{ capsuleId: string }[]>`
        SELECT DISTINCT c."capsuleId"
        FROM "WorkCapsuleActivity" a JOIN "WorkCapsule" c ON c.id = a."workCapsuleId"
        WHERE a.kind IN ('workroom-drive', 'workroom-drive-attention')
          AND a."recordedAt" >= ${since} AND a."recordedAt" < ${until}
        ORDER BY c."capsuleId"`;
      return rows.map((row) => row.capsuleId);
    },
    loadDriveLog: async (capsuleIds, since, until) => {
      if (capsuleIds.length === 0) return [];
      // Only the fields readDriveObservation reads: the snapshot's conclusion,
      // receipts and full ledger text never leave the database.
      const rows = await prisma.$queryRaw<{ capsuleId: string; scopeClaims: unknown; recordedAt: Date; payload: unknown }[]>`
        SELECT c."capsuleId", c."scopeClaims", a."recordedAt",
          jsonb_build_object(
            'action', a.payload->'action',
            'reason', a.payload->'reason',
            'stageKey', a.payload->'stageKey',
            'lastCycleKey', a.payload->'lastCycleKey',
            'conformance', jsonb_build_object('deviations',
              CASE WHEN jsonb_typeof(a.payload->'conformance'->'deviations') = 'array'
                THEN jsonb_build_array(jsonb_build_object('code', a.payload->'conformance'->'deviations'->0->'code'))
                ELSE '[]'::jsonb END),
            'ledger', COALESCE((
              SELECT jsonb_agg(substring(line FROM '^[a-z][a-z0-9_]*:'))
              FROM (
                SELECT line FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(a.payload->'ledger') = 'array' THEN a.payload->'ledger' ELSE '[]'::jsonb END
                ) AS line
                WHERE line ~ '^[a-z][a-z0-9_]*:'
                LIMIT 1
              ) first_code
            ), '[]'::jsonb)
          ) AS payload
        FROM "WorkCapsuleActivity" a JOIN "WorkCapsule" c ON c.id = a."workCapsuleId"
        WHERE a.kind IN ('workroom-drive', 'workroom-drive-attention')
          AND a."recordedAt" >= ${since} AND a."recordedAt" < ${until}
          AND c."capsuleId" IN (${Prisma.join(capsuleIds)})`;
      const byRoom = new Map<string, DriveLogRoom & { rows: { recordedAt: Date; payload: unknown }[] }>();
      for (const row of rows) {
        const room = byRoom.get(row.capsuleId) ?? { capsuleId: row.capsuleId, scopeClaims: row.scopeClaims, rows: [] };
        room.rows.push({ recordedAt: row.recordedAt, payload: row.payload });
        byRoom.set(room.capsuleId, room);
      }
      return [...byRoom.values()];
    },
    insert: async (rows) => {
      let count = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const batch = rows.slice(i, i + 1000).map((row) => ({
          queueKey: row.queueKey,
          itemKind: row.itemKind,
          itemId: row.itemId,
          transition: row.transition,
          outcome: row.outcome,
          laneKey: row.laneKey,
          actorType: row.actorType,
          actorId: row.actorId,
          occurredAt: row.occurredAt,
        }));
        count += (await prisma.queueTelemetryEvent.createMany({ data: batch })).count;
      }
      return count;
    },
    commit: async () => {
      await prisma.queueTelemetryEvent.updateMany({
        where: { itemKind: WORKROOM_STAGE_ITEM_KIND, actorId: STAGE_BACKFILL_STAGING_ACTOR },
        data: { actorId: STAGE_BACKFILL_ACTOR },
      });
    },
    aggregateDay: async (at) => {
      await aggregateQueueMetrics(stageOnly, { at });
    },
    now: () => new Date(),
  };
}
