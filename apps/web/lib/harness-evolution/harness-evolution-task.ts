// The deterministic executor for the daily `harness-evolution-loop` scheduled
// task (BI-49BC21C1 slice 1; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md).
//
// The room is the unit of improvement; this job is the aggregator. For each
// ring-0 delivery room it derives the room's own candidates from the room's
// own misses and records them on the room. It then rolls them up: cross-room
// recurrences become promotion candidates, beside the shape-level flow signals
// and the ring-0 platform queue. It records the run's budget and spend on one
// proactive TaskRun per UTC day and never edits a room's harness. It is a typed
// kind, not a prompt task: the prompt-only MCP-efficiency review narrates its
// tool call instead of making it (BI-A8679D84).

import { prisma } from "@dpf/db";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import { prismaHarnessEvolutionStore, type HarnessEvolutionStore } from "./harness-evolution-store";
import {
  MS_PER_DAY,
  RING0_LAYER,
  deriveRoomCandidates,
  findCrossRoomRecurrences,
  layerForShapeRef,
  readDeclaredWorkShapeRef,
  resolveHarnessEvolutionBudget,
  resolvePlatformQueue,
  resolveSeedItemIds,
  roomMissFromActivity,
  roomMissFromToolFailure,
  shapeKeyOf,
  type HarnessEvolutionBudget,
  type HarnessLayer,
  type RoomCandidate,
  type RoomMiss,
} from "./room-candidates";

/** Ring 0 first; archetype and ancillary layers join this list, not a new path. */
const LAYERS: readonly HarnessLayer[] = [RING0_LAYER];

export type HarnessEvolutionSpend = {
  roomsScanned: number;
  candidatesRecorded: number;
  probeReplays: number;
  tokens: number;
};

export type HarnessEvolutionRunResult = {
  periodKey: string;
  idempotent: boolean;
  taskRunId: string | null;
  budget: HarnessEvolutionBudget;
  spend: HarnessEvolutionSpend;
  roomsWithCandidates: number;
  roomsDeferred: number;
  crossRoomRecurrences: number;
};

/** UTC calendar day: one aggregate per day, one record per room per day. */
export function harnessEvolutionPeriodKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export async function runHarnessEvolutionLoop(
  store: HarnessEvolutionStore,
  input: { ownerUserId: string; agentId: string; taskId: string; taskConfig: unknown; now: Date },
): Promise<HarnessEvolutionRunResult> {
  const periodKey = harnessEvolutionPeriodKey(input.now);
  const repeatedPatternKey = `harness-evolution:${periodKey}`;
  const budget = resolveHarnessEvolutionBudget(input.taskConfig);
  const spend: HarnessEvolutionSpend = { roomsScanned: 0, candidatesRecorded: 0, probeReplays: 0, tokens: 0 };

  const existing = await store.findRun(repeatedPatternKey);
  if (existing) {
    return {
      periodKey, idempotent: true, taskRunId: existing.taskRunId, budget, spend,
      roomsWithCandidates: 0, roomsDeferred: 0, crossRoomRecurrences: 0,
    };
  }

  const since = new Date(input.now.getTime() - budget.lookbackDays * MS_PER_DAY);
  const rooms = (await store.listActiveRooms(since))
    .map((room) => {
      const shapeRef = readDeclaredWorkShapeRef(room.scopeClaims);
      return { ...room, shapeRef, layer: layerForShapeRef(shapeRef, LAYERS) };
    })
    .filter((room): room is typeof room & { shapeRef: string; layer: HarnessLayer } => room.layer !== null)
    .slice(0, budget.maxRooms);

  const missKinds = [...new Set(LAYERS.flatMap((layer) => Object.keys(layer.missKinds)))];
  const [toolFailures, activities] = await Promise.all([
    store.listToolFailures(rooms.map((room) => room.capsuleId), since),
    store.listRoomActivities(rooms.map((room) => room.id), missKinds, since),
  ]);
  const toolMissesByCapsule = new Map<string, RoomMiss[]>();
  for (const row of toolFailures) pushTo(toolMissesByCapsule, row.capsuleId, roomMissFromToolFailure(row));
  const activitiesByRoom = new Map<string, typeof activities>();
  for (const row of activities) pushTo(activitiesByRoom, row.workCapsuleId, row);

  const recorded: RoomCandidate[] = [];
  let roomsWithCandidates = 0;
  let roomsDeferred = 0;
  for (const room of rooms) {
    if (spend.candidatesRecorded >= budget.maxCandidates) {
      roomsDeferred += 1;
      continue;
    }
    spend.roomsScanned += 1;
    const misses = [
      ...(toolMissesByCapsule.get(room.capsuleId) ?? []),
      ...(activitiesByRoom.get(room.id) ?? []).flatMap((row) => roomMissFromActivity(row, room.layer) ?? []),
    ];
    const derived = deriveRoomCandidates({
      room: { capsuleId: room.capsuleId, shapeRef: room.shapeRef },
      layer: room.layer,
      misses,
      minRecurrence: budget.minRecurrence,
      maxCandidates: Math.min(budget.maxCandidatesPerRoom, budget.maxCandidates - spend.candidatesRecorded),
    });
    if (!derived.candidates.length) continue;
    await store.recordRoomCandidates({
      roomId: room.id,
      capsuleId: room.capsuleId,
      periodKey,
      agentId: input.agentId,
      summary: `${derived.candidates.length} recurring miss${derived.candidates.length === 1 ? "" : "es"} in this room `
        + `became harness-edit candidates (${room.layer.key}, ${room.shapeRef})`,
      payload: {
        periodKey,
        layer: room.layer.key,
        shapeRef: room.shapeRef,
        candidates: derived.candidates,
        belowThreshold: derived.belowThreshold,
        overCap: derived.overCap,
      },
    });
    roomsWithCandidates += 1;
    spend.candidatesRecorded += derived.candidates.length;
    recorded.push(...derived.candidates);
  }

  const crossRoomRecurrences = findCrossRoomRecurrences(recorded);
  const ring0ShapeKeys = new Set(rooms.map((room) => shapeKeyOf(room.shapeRef)));
  const shapeSignals = (await store.listShapeSignals(since)).flatMap((signal) => {
    const evidence = (signal.evidence ?? {}) as Record<string, unknown>;
    const shapeRef = typeof evidence.shapeRef === "string" ? evidence.shapeRef : null;
    if (!shapeRef || !layerForShapeRef(shapeRef, LAYERS)) return [];
    return [{
      signalId: signal.signalId,
      title: signal.title,
      recurrenceCount: signal.recurrenceCount,
      shapeRef,
      stageKey: typeof evidence.stageKey === "string" ? evidence.stageKey : null,
      cause: typeof evidence.cause === "string" ? evidence.cause : null,
      roomsInRun: ring0ShapeKeys.has(shapeKeyOf(shapeRef)),
    }];
  });
  const seedItemIds = resolveSeedItemIds(input.taskConfig);
  const platformQueue = resolvePlatformQueue(seedItemIds, await store.listBacklogItems(seedItemIds));

  const run = await store.recordRun({
    ownerUserId: input.ownerUserId,
    agentId: input.agentId,
    taskId: input.taskId,
    periodKey,
    repeatedPatternKey,
    completedAt: input.now,
    // Slice 1 derives and records only: no editor tokens, no probe replays.
    // Recorded as zero, not omitted, so the line compares once slice 2 spends.
    progressPayload: {
      periodKey, budget, spend, roomsWithCandidates, roomsDeferred,
      crossRoomRecurrences: crossRoomRecurrences.length,
    },
    artifactData: { periodKey, budget, spend, layers: LAYERS.map((layer) => layer.key), crossRoomRecurrences, shapeSignals, platformQueue },
    artifactDescription: `${roomsWithCandidates} rooms with candidates, ${crossRoomRecurrences.length} cross-room recurrences`,
  });

  return {
    periodKey, idempotent: false, taskRunId: run.taskRunId, budget, spend,
    roomsWithCandidates, roomsDeferred, crossRoomRecurrences: crossRoomRecurrences.length,
  };
}

/** One line for the schedule surface. */
export function describeHarnessEvolutionRun(result: HarnessEvolutionRunResult): string {
  if (result.idempotent) return `already recorded for ${result.periodKey} (${result.taskRunId})`;
  const recurrences = `${result.crossRoomRecurrences} cross-room recurrence${result.crossRoomRecurrences === 1 ? "" : "s"}`;
  const deferred = result.roomsDeferred ? `; ${result.roomsDeferred} rooms deferred by the cap` : "";
  return `${result.roomsWithCandidates} of ${result.spend.roomsScanned} ring-0 rooms hold ${result.spend.candidatesRecorded} candidates; `
    + `${recurrences}${deferred}; spend ${result.spend.tokens} tokens, ${result.spend.probeReplays} probe replays`;
}

/** The scheduled-task fields this branch reads. */
export interface HarnessEvolutionLoopTask {
  taskId: string;
  schedule: string;
  ownerUserId: string;
  agentId: string;
  taskConfig?: unknown;
}

export async function executeHarnessEvolutionLoopTask(
  task: HarnessEvolutionLoopTask,
  deps: { now?: Date; store?: HarnessEvolutionStore } = {},
): Promise<void> {
  const startedAt = deps.now ?? new Date();
  const nextRunAt = computeNextCronRun(task.schedule, startedAt);
  try {
    const result = await runHarnessEvolutionLoop(deps.store ?? prismaHarnessEvolutionStore, {
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      taskId: task.taskId,
      taskConfig: task.taskConfig,
      now: startedAt,
    });
    const summary = describeHarnessEvolutionRun(result);
    console.info("[harness-evolution-loop] %s", summary);
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt, taskRunId: result.taskRunId },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, lastRunSummary: summary, nextRunAt },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await prisma.scheduledAgentTask.update({
      where: { taskId: task.taskId },
      data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
    });
    await prisma.scheduledJob
      .update({
        where: { jobId: task.taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt },
      })
      .catch(() => {});
  }
}
