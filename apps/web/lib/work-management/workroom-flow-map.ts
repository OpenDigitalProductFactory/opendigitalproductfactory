/**
 * The room's flow map, as data (BI-FC0F4BD6, EP-B70E718D F3).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §4, §7 (L3).
 *
 * One picture of a room's work shape: what starts it, the steps in lanes by who
 * does them, the gates a person decides, how it ends — and, on each step, how
 * long THIS room has spent there against how long the shape typically takes.
 *
 * Pure. The definition says what the room should do; the drive snapshot says
 * where it is; the stage telemetry (F2) says how long it took. Rules:
 *
 *  - Lanes are derived from each stage's accountable principal, never declared.
 *  - Nothing is drawn that the runtime does not execute: a shape with a flow
 *    graph is reported as `graphFlow` and the renderer declines to draw it as
 *    a line (spec §5.4).
 *  - A typical time needs at least MIN_BASELINE_EXITS completed passes; below
 *    that it is "not enough history", never a number.
 */
import { computeFlowDurations, type QueueItemTimeline } from "@/lib/queue/flow-metrics";
import { reconstructTimelines, type QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";

import { shapeLane, shapeSignature, touchesOutside, type ShapeLane } from "./shape-signature";
import type { WorkShapeDefinition, WorkShapeTriggerClass } from "./work-shapes";
import { classifyDriveSegment } from "./workroom-flow-state";
import { holdCauseTag, workroomStageQueueKey, type DriveObservation } from "./workroom-stage-telemetry";

export const MIN_BASELINE_EXITS = 5;
/** A step is flagged slow when this room has spent this many times the typical time on it. */
export const SLOW_FACTOR = 1.5;

export type FlowMapStageState = "done" | "working" | "awaiting-person" | "blocked" | "ahead";

export type FlowMapStage = {
  key: string;
  title: string;
  lane: ShapeLane;
  touchesOutside: boolean;
  /** A person or the doctrine decides the way out of this step. */
  governed: boolean;
  principalRef: string;
  state: FlowMapStageState;
  /** Why the room is held here, when it is. */
  holdCause: string | null;
  room: { dwellMs: number; processMs: number | null; heldMs: number | null; open: boolean } | null;
  typical: { dwellMs: number; exits: number } | null;
  slow: boolean;
  /** Aggregate view only (F4): rooms at this step now, and how many are not being worked. */
  queue?: { wip: number; depth: number };
};

export type WorkroomFlowMapModel = {
  shapeRef: string;
  title: string;
  signature: string;
  triggers: WorkShapeTriggerClass[];
  stages: FlowMapStage[];
  ends: { success: boolean; failure: boolean; budget: boolean };
  /** True when the room has stopped (success or a declared failure). */
  finished: boolean;
  /** The shape declares a flow graph; the line renderer must not draw it. */
  graphFlow: boolean;
  /** Set for the shape-level view (F4): many rooms, no single room's position. */
  aggregate?: { roomsInFlow: number };
};

export type StageSnapshot = { queueKey: string; cycleP50Ms: number | null; throughput: number };

function stageTimes(
  rows: readonly QueueTelemetryRow[],
  now: Date,
): Map<string, FlowMapStage["room"]> {
  const byQueue = new Map<string, QueueTelemetryRow[]>();
  for (const row of rows) byQueue.set(row.queueKey, [...(byQueue.get(row.queueKey) ?? []), row]);
  const out = new Map<string, FlowMapStage["room"]>();
  for (const [queueKey, queueRows] of byQueue) {
    // The newest pass through the step is the one the room is on or just left.
    const timelines = reconstructTimelines(queueRows)
      .filter((t) => t.enqueuedAt)
      .sort((a, b) => b.enqueuedAt!.getTime() - a.enqueuedAt!.getTime());
    const latest = timelines[0];
    if (!latest) continue;
    const open = !latest.finishedAt && !latest.cancelledAt;
    const measured: QueueItemTimeline = open ? { ...latest, finishedAt: now } : latest;
    const durations = computeFlowDurations(measured);
    if (durations.cycleMs == null) continue;
    out.set(queueKey, {
      dwellMs: durations.cycleMs,
      processMs: durations.processMs,
      heldMs: durations.heldMs,
      open,
    });
  }
  return out;
}

function typicalTimes(snapshots: readonly StageSnapshot[]): Map<string, FlowMapStage["typical"]> {
  const acc = new Map<string, { weighted: number; exits: number }>();
  for (const snapshot of snapshots) {
    if (snapshot.cycleP50Ms == null || snapshot.throughput <= 0) continue;
    const entry = acc.get(snapshot.queueKey) ?? { weighted: 0, exits: 0 };
    entry.weighted += snapshot.cycleP50Ms * snapshot.throughput;
    entry.exits += snapshot.throughput;
    acc.set(snapshot.queueKey, entry);
  }
  const out = new Map<string, FlowMapStage["typical"]>();
  for (const [queueKey, { weighted, exits }] of acc) {
    out.set(queueKey, exits >= MIN_BASELINE_EXITS ? { dwellMs: Math.round(weighted / exits), exits } : null);
  }
  return out;
}

export function buildWorkroomFlowMap(input: {
  definition: Pick<WorkShapeDefinition, "key" | "version" | "title" | "triggers" | "stages" | "stopConditions" | "flow">;
  current: DriveObservation | null;
  /** Stage telemetry rows for this room's items. */
  roomRows: readonly QueueTelemetryRow[];
  /** Recent daily snapshots for this shape version's stage queues. */
  snapshots: readonly StageSnapshot[];
  now: Date;
}): WorkroomFlowMapModel {
  const { definition, current, now } = input;
  const shapeRef = `${definition.key}@${definition.version}`;
  const classified = current?.action && current.reason
    ? classifyDriveSegment({ action: current.action, reason: current.reason })
    : null;
  const finished = classified?.state === "done";
  const room = stageTimes(input.roomRows, now);
  const typical = typicalTimes(input.snapshots);

  // The step the room is on: the drive names it, or (for a hold raised without
  // one) the newest step this room entered and has not left.
  const openFromTelemetry = [...room.entries()].find(([, times]) => times?.open)?.[0] ?? null;
  const currentKey = current?.stageKey
    ?? (openFromTelemetry ? definition.stages.find((s) => workroomStageQueueKey(shapeRef, s.key) === openFromTelemetry)?.key ?? null : null);
  const currentIndex = currentKey ? definition.stages.findIndex((s) => s.key === currentKey) : -1;

  const stageState = (index: number): FlowMapStageState => {
    if (finished || (currentIndex >= 0 && index < currentIndex)) return "done";
    if (index !== currentIndex || !classified) return "ahead";
    // A finished cycle has left its last step; any in-flow state is the step's state.
    if (classified.state === "awaiting-trigger") return "done";
    return classified.state === "done" ? "done" : classified.state;
  };

  const stages: FlowMapStage[] = definition.stages.map((stage, index) => {
    const queueKey = workroomStageQueueKey(shapeRef, stage.key);
    const state = stageState(index);
    const times = room.get(queueKey) ?? null;
    const usual = typical.get(queueKey) ?? null;
    return {
      key: stage.key,
      title: stage.title,
      lane: shapeLane(stage),
      touchesOutside: touchesOutside(stage),
      governed: stage.advance.kind === "governed-decision",
      principalRef: stage.accountablePrincipalRef,
      state,
      holdCause: state === "blocked" ? holdCauseTag(classified?.cause ?? null, current?.detail) : null,
      room: times,
      typical: usual,
      slow: Boolean(times && usual && times.dwellMs > usual.dwellMs * SLOW_FACTOR),
    };
  });

  return {
    shapeRef,
    title: definition.title,
    signature: shapeSignature(definition),
    triggers: [...definition.triggers],
    stages,
    ends: {
      success: definition.stopConditions.some((stop) => stop.kind === "success"),
      failure: definition.stopConditions.some((stop) => stop.kind === "failure"),
      budget: definition.stopConditions.some((stop) => stop.kind === "budget"),
    },
    finished,
    graphFlow: Boolean(definition.flow),
  };
}

/** "3d 4h", "2h 10m", "45m", "<1m". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/**
 * The shape-level map (BI-C5CD9EAE, F4): the same picture, read across every
 * room on the shape version. No step has a single "current" state; instead each
 * step carries its live queue, and the timing band shows typical times.
 */
export function buildShapeFlowMap(input: {
  definition: Parameters<typeof buildWorkroomFlowMap>[0]["definition"];
  snapshots: readonly StageSnapshot[];
  liveCounts: ReadonlyMap<string, { wip: number; depth: number }>;
  now: Date;
}): WorkroomFlowMapModel {
  const base = buildWorkroomFlowMap({ definition: input.definition, current: null, roomRows: [], snapshots: input.snapshots, now: input.now });
  let roomsInFlow = 0;
  const stages = base.stages.map((stage) => {
    const queue = input.liveCounts.get(workroomStageQueueKey(base.shapeRef, stage.key)) ?? { wip: 0, depth: 0 };
    roomsInFlow += queue.wip;
    // Across many rooms a step has no single state; the queue numbers carry it.
    const state: FlowMapStageState = queue.wip > 0 ? "working" : "ahead";
    return { ...stage, state, queue };
  });
  return { ...base, stages, aggregate: { roomsInFlow } };
}

