/**
 * A Workroom stage is a queue (BI-4ADFFEDB, EP-B70E718D F2).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §6.
 *
 * Every stage of every work shape reports into the platform's ONE flow
 * telemetry contract (QueueTelemetryEvent → QueueMetricSnapshot), under a key
 * that names the shape version and the stage. Nothing new stores metrics: the
 * snapshots, the Prometheus mirror and the coworker queue tools all read the
 * same rows they already read for every other queue.
 *
 *   queueKey  wr:<shapeKey>@<version>:<stageKey>
 *   itemKind  workroom-stage
 *   itemId    <capsuleId>:<cycleKey> for a recurring shape, <capsuleId>:run for a finite one
 *
 * The drive stamps every room with a daily cycle key. Only a shape that
 * recurs (a cadence) has cycles; a finite room is one run however many days
 * it takes, so its cycle stamp is ignored. A recurring cycle still open when
 * the next one begins did not complete: it is cancelled (abandoned), never
 * counted as a success, so it stays out of flow time and throughput.
 *
 * The drive records a trail row only when a room's state changes. This module
 * turns the change between two drive snapshots into queue transitions:
 *
 *   entering a stage            enqueued, then started (working) or held (waiting)
 *   working → waiting/blocked   held, lane = the cause
 *   waiting/blocked → working   released, started (the first start wins)
 *   leaving a stage             released if held, then finished
 *   a stop                      finished: success for `success`, failed otherwise
 *   a new cycle over an open one   cancelled (the open cycle never completed)
 *
 * Pure, apart from `emitStageTransitions`, which hands the plan to the
 * fire-and-forget writer. A telemetry failure never touches the drive.
 */
import type { QueueOutcome, QueueTransition } from "@/lib/queue/flow-metrics";
import type { QueueTransitionInput } from "@/lib/queue/queue-telemetry";

import { getWorkShapeVersion, workShapeRecurs } from "./work-shapes";
import { readWorkShapeClaimRef } from "./workroom-shape-claim";
import { classifyDriveSegment, type WorkroomFlowState } from "./workroom-flow-state";
import { holdCauseTag } from "./workroom-hold-cause";

export { describeHoldCause, holdCauseTag } from "./workroom-hold-cause";

export const WORKROOM_STAGE_ITEM_KIND = "workroom-stage";
export const WORKROOM_STAGE_QUEUE_PREFIX = "wr:";

/** What one drive snapshot says about where the room is. */
export type DriveObservation = {
  action: string | null;
  reason: string | null;
  stageKey: string | null;
  cycleKey: string | null;
  /**
   * The first conformance deviation code when the drive paused or escalated on
   * conformance: from `conformance.deviations`, or else the `<code>: <text>`
   * prefix of the drive's ledger, which is where the live drive writes it.
   */
  detail?: string | null;
};


export type StageTransition = Required<Pick<QueueTransitionInput, "queueKey" | "itemKind" | "itemId" | "transition">> & {
  outcome: QueueOutcome | null;
  laneKey: string | null;
  actorType: "human" | "ai-agent" | "system";
  occurredAt: Date;
};

export function workroomStageQueueKey(shapeRef: string, stageKey: string): string {
  return `${WORKROOM_STAGE_QUEUE_PREFIX}${shapeRef}:${stageKey}`;
}

export function workroomStageItemId(capsuleId: string, cycleKey: string | null): string {
  return `${capsuleId}:${cycleKey ?? "run"}`;
}

/** Read the drive snapshot the drive persists at `workspaceState.workroomDrive`. */
export function readDriveObservation(workspaceState: unknown): DriveObservation | null {
  const state = workspaceState && typeof workspaceState === "object" ? (workspaceState as Record<string, unknown>) : null;
  const drive = state?.workroomDrive && typeof state.workroomDrive === "object"
    ? (state.workroomDrive as Record<string, unknown>)
    : null;
  if (!drive) return null;
  const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
  const reason = str(drive.reason);
  const conformance = drive.conformance && typeof drive.conformance === "object" ? (drive.conformance as Record<string, unknown>) : null;
  const first = Array.isArray(conformance?.deviations) ? (conformance!.deviations as unknown[])[0] : null;
  const ledgerCode = Array.isArray(drive.ledger)
    ? (drive.ledger as unknown[]).map((line) => (typeof line === "string" ? /^([a-z][a-z0-9_]*):/.exec(line)?.[1] : undefined)).find(Boolean) ?? null
    : null;
  const code = (first && typeof first === "object" ? str((first as Record<string, unknown>).code) : null) ?? ledgerCode;
  return {
    action: str(drive.action),
    reason,
    stageKey: str(drive.stageKey),
    cycleKey: str(drive.lastCycleKey),
    detail: reason?.startsWith("conformance_") ? code : null,
  };
}

/**
 * The first stage of a shape version. A room the drive holds before any stage
 * has run (a conformance pause on a room that never started) is waiting at
 * this door, so its hold is measured here rather than dropped.
 */
export function entryStageKey(shapeRef: string | null): string | null {
  return definitionOf(shapeRef)?.stages[0]?.key ?? null;
}

/** Whether a shape version recurs on a cadence; a finite shape is one run per room. */
export function shapeRecurs(shapeRef: string | null): boolean {
  const definition = definitionOf(shapeRef);
  return definition ? workShapeRecurs(definition) : false;
}

function definitionOf(shapeRef: string | null) {
  const at = shapeRef ? shapeRef.lastIndexOf("@") : -1;
  if (!shapeRef || at <= 0) return null;
  return getWorkShapeVersion(shapeRef.slice(0, at), shapeRef.slice(at + 1));
}

const IN_FLOW: ReadonlySet<WorkroomFlowState> = new Set(["working", "awaiting-person", "blocked"]);

type Located = { state: WorkroomFlowState; cause: string | null; stageKey: string | null; cycleKey: string | null };

/**
 * Classify a snapshot and name its stage. A hold the drive raised without
 * naming a stage sits at the stage the room is known to be in (`knownStage`),
 * or, when it has not entered one, at the shape's first stage.
 */
function locate(observation: DriveObservation | null, shapeRef: string | null, knownStage?: string | null): Located | null {
  if (!observation?.action || !observation.reason) return null;
  const classified = classifyDriveSegment({ action: observation.action, reason: observation.reason });
  if (!classified) return null;
  const held = classified.state === "awaiting-person" || classified.state === "blocked";
  return {
    ...classified,
    cause: classified.state === "blocked" ? holdCauseTag(classified.cause, observation.detail) : classified.cause,
    stageKey: observation.stageKey ?? (held ? knownStage ?? entryStageKey(shapeRef) : null),
    cycleKey: shapeRecurs(shapeRef) ? observation.cycleKey : null,
  };
}

function holdLane(located: Located): string {
  // A person's decision is its own queue, not a blockage; blocked holds keep
  // the drive reason so a pile can say why.
  return located.state === "awaiting-person" ? "awaiting-person" : (located.cause ?? located.state);
}

function actorFor(state: WorkroomFlowState): StageTransition["actorType"] {
  if (state === "working") return "ai-agent";
  if (state === "awaiting-person") return "human";
  return "system";
}

/**
 * The transitions that take a stage's queue from the `prior` snapshot to the
 * `next` one. Empty when nothing measurable changed, when either snapshot is
 * unclassifiable, or when no stage can be named (the drive reported no stage
 * and the prior one is unknown).
 */
export function planStageTransitions(input: {
  capsuleId: string;
  shapeRef: string | null;
  prior: DriveObservation | null;
  next: DriveObservation;
  at: Date;
  /**
   * The stage the room's measured item is open at, when the caller knows it
   * (the replay tracks it; the live hook reads the newest stage event). Lets a
   * run of stage-less holds stay on the stage the room was really in.
   */
  openStageKey?: string | null;
}): StageTransition[] {
  const { capsuleId, shapeRef, at } = input;
  if (!shapeRef) return [];
  const before = locate(input.prior, shapeRef, input.openStageKey);
  const priorOpen = before && IN_FLOW.has(before.state) && before.stageKey ? before : null;
  // A room that went idle without completing its cycle left its item open and
  // held; the caller knows where (`openStageKey`). Re-attach to it rather than
  // entering the same item twice.
  const idleOpen: Located | null = !priorOpen && before?.state === "awaiting-trigger" && input.prior?.reason !== "cycle_complete" && input.openStageKey
    ? { ...before, state: "blocked", stageKey: input.openStageKey }
    : null;
  const open = priorOpen ?? idleOpen;
  const nextCycle = shapeRecurs(shapeRef) ? input.next.cycleKey : null;
  // A hold the drive raised without naming a stage (a conformance pause) holds
  // the stage the room was already in, or, when it has not entered one, the
  // shape's first stage.
  const after = locate(input.next, shapeRef, open && open.cycleKey === nextCycle ? open.stageKey : null);
  if (!after) return [];
  const nextStage = after.stageKey;

  const out: StageTransition[] = [];
  const emit = (
    on: { stageKey: string; cycleKey: string | null },
    transition: QueueTransition,
    extra: { outcome?: QueueOutcome; laneKey?: string; actor: StageTransition["actorType"] },
  ) => {
    out.push({
      queueKey: workroomStageQueueKey(shapeRef, on.stageKey),
      itemKind: WORKROOM_STAGE_ITEM_KIND,
      itemId: workroomStageItemId(capsuleId, on.cycleKey),
      transition,
      outcome: extra.outcome ?? null,
      laneKey: extra.laneKey ?? null,
      actorType: extra.actor,
      occurredAt: at,
    });
  };

  const close = (item: Located & { stageKey: string }, outcome: QueueOutcome) => {
    if (item.state !== "working") emit(item, "released", { actor: "system" });
    emit(item, "finished", { outcome, actor: actorFor(item.state) });
  };

  // The open item belongs to a cycle that is over without completing.
  const abandon = (item: Located & { stageKey: string }) => {
    if (item.state !== "working") emit(item, "released", { actor: "system" });
    emit(item, "cancelled", { outcome: "cancelled", actor: "system" });
  };

  const enter = (stageKey: string) => {
    const on = { stageKey, cycleKey: after.cycleKey };
    emit(on, "enqueued", { actor: "system" });
    if (after.state === "working") emit(on, "started", { actor: "ai-agent" });
    else emit(on, "held", { laneKey: holdLane(after), actor: actorFor(after.state) });
  };

  const openItem = open as (Located & { stageKey: string }) | null;

  if (after.state === "done") {
    if (openItem) close(openItem, input.next.reason === "success" ? "success" : "failed");
    return out;
  }

  if (after.state === "awaiting-trigger") {
    if (!openItem) return out;
    // A finished cycle completes the stage it was in. Any other idle reason
    // (a quiet posture, an empty read) leaves the item sitting in the stage,
    // which is held time, not a completion.
    if (input.next.reason === "cycle_complete") close(openItem, "success");
    else if (openItem.state === "working") emit(openItem, "held", { laneKey: input.next.reason ?? "idle", actor: "system" });
    return out;
  }

  if (!nextStage) return out;

  const sameItem = openItem && openItem.stageKey === nextStage && openItem.cycleKey === after.cycleKey;
  if (openItem && !sameItem) {
    // Moving on within a cycle completes the step; a new cycle over an open
    // one abandons it.
    if (openItem.cycleKey === after.cycleKey) close(openItem, "success");
    else abandon(openItem);
    enter(nextStage);
    return out;
  }
  if (!openItem) {
    enter(nextStage);
    return out;
  }

  // Same stage, same cycle: the state inside the stage changed.
  const on = { stageKey: nextStage, cycleKey: after.cycleKey };
  const wasHeld = openItem.state !== "working";
  const isHeld = after.state !== "working";
  if (!wasHeld && isHeld) {
    emit(on, "held", { laneKey: holdLane(after), actor: actorFor(after.state) });
  } else if (wasHeld && !isHeld) {
    emit(on, "released", { actor: "system" });
    emit(on, "started", { actor: "ai-agent" });
  } else if (wasHeld && isHeld && holdLane(openItem) !== holdLane(after)) {
    emit(on, "released", { actor: "system" });
    emit(on, "held", { laneKey: holdLane(after), actor: actorFor(after.state) });
  }
  return out;
}

/**
 * Rooms currently sitting at each stage. WIP is every room in the stage; depth
 * (queue) is the ones not being worked right now.
 */
export function workroomStageLiveCounts(
  rooms: readonly { scopeClaims: unknown; workspaceState: unknown }[],
): Map<string, { depth: number; wip: number }> {
  const counts = new Map<string, { depth: number; wip: number }>();
  for (const room of rooms) {
    const shapeRef = readWorkShapeClaimRef(room.scopeClaims);
    const located = locate(readDriveObservation(room.workspaceState), shapeRef);
    if (!shapeRef || !located?.stageKey || !IN_FLOW.has(located.state)) continue;
    const key = workroomStageQueueKey(shapeRef, located.stageKey);
    const entry = counts.get(key) ?? { depth: 0, wip: 0 };
    entry.wip += 1;
    if (located.state !== "working") entry.depth += 1;
    counts.set(key, entry);
  }
  return counts;
}

/**
 * The stage a run of transitions leaves the room's item open at: the stage of
 * the last enqueue not followed by a finish, or `open` unchanged when the run
 * neither opens nor closes an item.
 */
export function openStageAfter(open: string | null, transitions: readonly StageTransition[]): string | null {
  let current = open;
  for (const t of transitions) {
    if (t.transition === "enqueued") current = t.queueKey.slice(t.queueKey.lastIndexOf(":") + 1);
    else if (t.transition === "finished" || t.transition === "cancelled") current = null;
  }
  return current;
}

/**
 * Close a room's open steps when the room ends (BI-C9F1DE01). A terminal room
 * never writes again, so the drive cannot close them: each step whose latest
 * event is not a finish or cancel is released (if held) and cancelled, at
 * `at` or just after its own last event. Steps already closed plan nothing, so
 * a second pass is a no-op.
 */
export function planRoomEndClosures(
  events: readonly { queueKey: string; itemId: string; transition: string; occurredAt: Date }[],
  at: Date,
): StageTransition[] {
  const latest = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = `${event.queueKey}\x00${event.itemId}`;
    const seen = latest.get(key);
    if (!seen || event.occurredAt.getTime() >= seen.occurredAt.getTime()) latest.set(key, event);
  }
  const out: StageTransition[] = [];
  for (const event of latest.values()) {
    if (event.transition === "finished" || event.transition === "cancelled") continue;
    const occurredAt = new Date(Math.max(at.getTime(), event.occurredAt.getTime() + 1));
    const base = { queueKey: event.queueKey, itemKind: WORKROOM_STAGE_ITEM_KIND, itemId: event.itemId, laneKey: null, actorType: "system" as const, occurredAt };
    if (event.transition === "held") out.push({ ...base, transition: "released", outcome: null });
    out.push({ ...base, transition: "cancelled", outcome: "cancelled" });
  }
  return out;
}

/** Hand a plan to the fire-and-forget writer. Never throws. */
export async function emitStageTransitions(
  transitions: readonly StageTransition[],
  record?: (input: QueueTransitionInput) => Promise<void>,
): Promise<void> {
  if (transitions.length === 0) return;
  const write = record ?? (await import("@/lib/queue/queue-telemetry")).recordQueueTransition;
  // In order: a stage's release must land before the next stage's enqueue.
  for (const transition of transitions) await write(transition);
}

/**
 * The drive's hook: called after it writes a state-change trail row, with the
 * room as it was before the write and the snapshot it wrote. Sequential shapes
 * only — a graph room's parallel branches are measured once a graph shape is
 * live. Never throws.
 */
export async function emitStageTelemetryForDriveWrite(input: {
  room: { capsuleId: string; scopeClaims: unknown; workspaceState: unknown };
  snapshot: Record<string, unknown>;
  graphShape?: boolean;
  at: Date;
  /** Reads the stage the room's item is open at; defaults to the newest stage event. */
  readOpenStage?: (capsuleId: string) => Promise<string | null>;
}): Promise<void> {
  try {
    if (input.graphShape) return;
    const next = readDriveObservation({ workroomDrive: input.snapshot });
    if (!next) return;
    const readOpenStage = input.readOpenStage ?? readOpenStageFromTelemetry;
    await emitStageTransitions(planStageTransitions({
      capsuleId: input.room.capsuleId,
      shapeRef: readWorkShapeClaimRef(input.room.scopeClaims),
      prior: readDriveObservation(input.room.workspaceState),
      next,
      at: input.at,
      openStageKey: await readOpenStage(input.room.capsuleId),
    }));
  } catch {
    // Observability must never break the work it observes.
  }
}


/** Rooms at each Workroom stage queue now, from every live room: wip at the stage, depth not being worked. */
export async function loadWorkroomStageLiveCounts(): Promise<Map<string, { wip: number; depth: number }>> {
  const { prisma } = await import("@dpf/db");
  const { TERMINAL_WORKROOM_STATUSES } = await import("./standing-room-nesting");
  const rooms = await prisma.workroom.findMany({
    where: { archivedAt: null, status: { notIn: [...TERMINAL_WORKROOM_STATUSES] } },
    select: { scopeClaims: true, workspaceState: true },
  });
  return workroomStageLiveCounts(rooms);
}

/** Close the open steps of one room that has just ended (BI-C9F1DE01). Never throws. */
export async function closeStageTelemetryForEndedRoom(capsuleId: string, at: Date): Promise<number> {
  try {
    const { prisma } = await import("@dpf/db");
    const events = await prisma.queueTelemetryEvent.findMany({
      where: { itemKind: WORKROOM_STAGE_ITEM_KIND, itemId: { startsWith: `${capsuleId}:` } },
      select: { queueKey: true, itemId: true, transition: true, occurredAt: true },
    });
    const plan = planRoomEndClosures(events, at);
    await emitStageTransitions(plan);
    return plan.filter((t) => t.transition === "cancelled").length;
  } catch {
    return 0;
  }
}

/**
 * Close every step left open on a room that already ended, at the time the
 * room last changed (BI-C9F1DE01). The backstop for rooms ended inside a
 * caller's transaction and for history before the close existed. Idempotent:
 * a closed step is no longer open. Returns the steps closed.
 */
export async function reconcileEndedRoomStageTelemetry(): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const { TERMINAL_WORKROOM_STATUSES } = await import("./standing-room-nesting");
  const open = await prisma.$queryRaw<{ queueKey: string; itemId: string; transition: string; occurredAt: Date; endedAt: Date }[]>`
    WITH latest AS (
      SELECT DISTINCT ON (e."queueKey", e."itemId") e."queueKey", e."itemId", e."transition", e."occurredAt"
      FROM "QueueTelemetryEvent" e
      WHERE e."itemKind" = ${WORKROOM_STAGE_ITEM_KIND}
      ORDER BY e."queueKey", e."itemId", e."occurredAt" DESC
    )
    SELECT l."queueKey", l."itemId", l."transition", l."occurredAt", w."updatedAt" AS "endedAt"
    FROM latest l
    JOIN "WorkCapsule" w ON w."capsuleId" = split_part(l."itemId", ':', 1)
    WHERE l."transition" NOT IN ('finished', 'cancelled')
      AND w."status" = ANY(${[...TERMINAL_WORKROOM_STATUSES]})`;
  let closed = 0;
  for (const row of open) {
    const plan = planRoomEndClosures([row], row.endedAt);
    await emitStageTransitions(plan);
    closed += 1;
  }
  return closed;
}

/** The stage of the room's newest stage event, unless that event closed the item. */
async function readOpenStageFromTelemetry(capsuleId: string): Promise<string | null> {
  const { prisma } = await import("@dpf/db");
  const latest = await prisma.queueTelemetryEvent.findFirst({
    where: { itemKind: WORKROOM_STAGE_ITEM_KIND, itemId: { startsWith: `${capsuleId}:` } },
    orderBy: { occurredAt: "desc" },
    select: { queueKey: true, transition: true },
  });
  if (!latest || latest.transition === "finished" || latest.transition === "cancelled") return null;
  return latest.queueKey.slice(latest.queueKey.lastIndexOf(":") + 1);
}
