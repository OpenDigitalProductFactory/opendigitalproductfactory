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
 * - Idempotent: replayed rows carry actorId `backfill:drive-log`; when any
 *   exist the replay does nothing.
 * - Never double counts: it replays only rows older than the first live stage
 *   event.
 * - Resolution is the drive tick, and the shape is the room's current claim.
 *   Both are stated limitations; live events after deploy have neither.
 * - Past days are re-aggregated for `wr:` queues only, with no live counts, so
 *   no other queue's history is touched.
 */
import { aggregateQueueMetrics, type QueueTelemetryRow, type RollupDeps } from "@/lib/queue/queue-metrics-rollup";

import { readDeclaredWorkShapeRef } from "./work-shapes";
import {
  WORKROOM_STAGE_ITEM_KIND,
  WORKROOM_STAGE_QUEUE_PREFIX,
  planStageTransitions,
  readDriveObservation,
  type StageTransition,
} from "./workroom-stage-telemetry";

export const STAGE_BACKFILL_ACTOR = "backfill:drive-log";
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
    const shapeRef = readDeclaredWorkShapeRef(room.scopeClaims);
    if (!shapeRef) continue;
    const ordered = [...room.rows]
      .filter((row) => row.recordedAt.getTime() < until.getTime())
      .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    let prior = null as ReturnType<typeof readDriveObservation>;
    for (const row of ordered) {
      const next = readDriveObservation({ workroomDrive: row.payload });
      if (!next) continue;
      out.push(...planStageTransitions({ capsuleId: room.capsuleId, shapeRef, prior, next, at: row.recordedAt }));
      prior = next;
    }
  }
  return out;
}

export type StageBackfillDeps = {
  alreadyBackfilled: () => Promise<boolean>;
  /** Earliest live (non-backfill) stage event, or null when none yet. */
  firstLiveEventAt: () => Promise<Date | null>;
  loadDriveLog: (since: Date, until: Date) => Promise<DriveLogRoom[]>;
  insert: (rows: readonly (StageTransition & { actorId: string })[]) => Promise<number>;
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
  const until = (await deps.firstLiveEventAt()) ?? now;
  const transitions = replayDriveLog(await deps.loadDriveLog(since, until), until);
  const inserted = await deps.insert(transitions.map((t) => ({ ...t, actorId: STAGE_BACKFILL_ACTOR })));

  const days = new Set(transitions.map((t) => t.occurredAt.toISOString().slice(0, 10)));
  for (const day of [...days].sort()) await deps.aggregateDay(new Date(`${day}T12:00:00.000Z`));
  return { ran: true, transitions: inserted, days: days.size, until: until.toISOString() };
}

/** Deps bound to the live Prisma client. */
export async function defaultStageBackfillDeps(): Promise<StageBackfillDeps> {
  const { prisma } = await import("@dpf/db");
  const { defaultRollupDeps } = await import("@/lib/queue/queue-metrics-rollup");
  const rollup = await defaultRollupDeps();
  const stageOnly: RollupDeps = {
    ...rollup,
    fetchEvents: async (start, end) =>
      (await rollup.fetchEvents(start, end)).filter((row: QueueTelemetryRow) => row.queueKey.startsWith(WORKROOM_STAGE_QUEUE_PREFIX)),
    fetchLiveCounts: async () => new Map(),
  };
  return {
    alreadyBackfilled: async () =>
      (await prisma.queueTelemetryEvent.findFirst({
        where: { itemKind: WORKROOM_STAGE_ITEM_KIND, actorId: STAGE_BACKFILL_ACTOR },
        select: { id: true },
      })) !== null,
    firstLiveEventAt: async () =>
      (await prisma.queueTelemetryEvent.findFirst({
        where: { itemKind: WORKROOM_STAGE_ITEM_KIND, NOT: { actorId: STAGE_BACKFILL_ACTOR } },
        orderBy: { occurredAt: "asc" },
        select: { occurredAt: true },
      }))?.occurredAt ?? null,
    loadDriveLog: async (since, until) => {
      const rows = await prisma.workroomActivity.findMany({
        where: { kind: { in: ["workroom-drive", "workroom-drive-attention"] }, recordedAt: { gte: since, lt: until } },
        select: { recordedAt: true, payload: true, capsule: { select: { capsuleId: true, scopeClaims: true } } },
      });
      const byRoom = new Map<string, DriveLogRoom & { rows: { recordedAt: Date; payload: unknown }[] }>();
      for (const row of rows) {
        const room = byRoom.get(row.capsule.capsuleId)
          ?? { capsuleId: row.capsule.capsuleId, scopeClaims: row.capsule.scopeClaims, rows: [] };
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
    aggregateDay: async (at) => {
      await aggregateQueueMetrics(stageOnly, { at });
    },
    now: () => new Date(),
  };
}
