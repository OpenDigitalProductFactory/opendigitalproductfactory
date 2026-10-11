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
 *   itemId    <capsuleId>:<cycleKey | "run">
 *
 * The drive records a trail row only when a room's state changes. This module
 * turns the change between two drive snapshots into queue transitions:
 *
 *   entering a stage            enqueued, then started (working) or held (waiting)
 *   working → waiting/blocked   held, lane = the cause
 *   waiting/blocked → working   released, started (the first start wins)
 *   leaving a stage             released if held, then finished
 *   a stop                      finished: success for `success`, failed otherwise
 *
 * Pure, apart from `emitStageTransitions`, which hands the plan to the
 * fire-and-forget writer. A telemetry failure never touches the drive.
 */
import type { QueueOutcome, QueueTransition } from "@/lib/queue/flow-metrics";
import type { QueueTransitionInput } from "@/lib/queue/queue-telemetry";

import { getWorkShapeVersion } from "./work-shapes";
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
  const at = shapeRef ? shapeRef.lastIndexOf("@") : -1;
  if (!shapeRef || at <= 0) return null;
  return getWorkShapeVersion(shapeRef.slice(0, at), shapeRef.slice(at + 1))?.stages[0]?.key ?? null;
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
    cycleKey: observation.cycleKey,
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
  // A hold the drive raised without naming a stage (a conformance pause) holds
  // the stage the room was already in, or, when it has not entered one, the
  // shape's first stage.
  const after = locate(input.next, shapeRef, priorOpen && priorOpen.cycleKey === input.next.cycleKey ? priorOpen.stageKey : null);
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

  const close = (open: Located & { stageKey: string }, outcome: QueueOutcome) => {
    if (open.state !== "working") emit(open, "released", { actor: "system" });
    emit(open, "finished", { outcome, actor: actorFor(open.state) });
  };

  const enter = (stageKey: string) => {
    const on = { stageKey, cycleKey: after.cycleKey };
    emit(on, "enqueued", { actor: "system" });
    if (after.state === "working") emit(on, "started", { actor: "ai-agent" });
    else emit(on, "held", { laneKey: holdLane(after), actor: actorFor(after.state) });
  };

  if (after.state === "done") {
    if (priorOpen) close(priorOpen as Located & { stageKey: string }, input.next.reason === "success" ? "success" : "failed");
    return out;
  }

  if (after.state === "awaiting-trigger") {
    if (!priorOpen) return out;
    // A finished cycle completes the stage it was in. Any other idle reason
    // (a quiet posture, an empty read) leaves the item sitting in the stage,
    // which is held time, not a completion.
    if (input.next.reason === "cycle_complete") close(priorOpen as Located & { stageKey: string }, "success");
    else if (priorOpen.state === "working") emit(priorOpen as Located & { stageKey: string }, "held", { laneKey: input.next.reason ?? "idle", actor: "system" });
    return out;
  }

  if (!nextStage) return out;

  const sameItem = priorOpen && priorOpen.stageKey === nextStage && priorOpen.cycleKey === after.cycleKey;
  if (priorOpen && !sameItem) {
    close(priorOpen as Located & { stageKey: string }, "success");
    enter(nextStage);
    return out;
  }
  if (!priorOpen) {
    enter(nextStage);
    return out;
  }

  // Same stage, same cycle: the state inside the stage changed.
  const on = { stageKey: nextStage, cycleKey: after.cycleKey };
  const wasHeld = priorOpen.state !== "working";
  const isHeld = after.state !== "working";
  if (!wasHeld && isHeld) {
    emit(on, "held", { laneKey: holdLane(after), actor: actorFor(after.state) });
  } else if (wasHeld && !isHeld) {
    emit(on, "released", { actor: "system" });
    emit(on, "started", { actor: "ai-agent" });
  } else if (wasHeld && isHeld && holdLane(priorOpen) !== holdLane(after)) {
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
