/**
 * The flow review receipt (BI-C684AF45, EP-B70E718D F8b).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §8.
 *
 * At each of a shape version's review points (`reviewPoint.everyDays` after
 * its first stage data) the review compares the trailing FLOW_WINDOW_DAYS with
 * the version's baseline, its first four weeks, and names the step where the
 * most waiting accrues (rooms held × typical wait).
 *
 * Pure and replayable: a receipt is a projection over the per-stage daily
 * QueueMetricSnapshot rows, not a stored record (DI-01E4DB4D7126), so any past
 * review reads the same from the same data. Daily snapshots do not record why
 * rooms are held, so only the latest review names a cause, from the live holds.
 *
 * Scope: stage snapshots are keyed by shape version, not by area, so a review
 * covers every room on that version wherever it sits. The live holds that give
 * the latest cause must cover the same rooms, never one area's share of them.
 */
import { FLOW_WINDOW_DAYS, type StageHold } from "./portfolio-flow";
import { topByWaitTimesQueue, typicalStepWaitMs, type StepSnapshot } from "./shape-step-measures";
import { classifyDriveSegment } from "./workroom-flow-state";
import { MIN_BASELINE_EXITS } from "./workroom-flow-map";
import { holdCauseTag } from "./workroom-hold-cause";
import { workroomStageQueueKey, type DriveObservation } from "./workroom-stage-telemetry";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A version's baseline is its first four weeks of stage data. */
export const BASELINE_DAYS = 28;
/** Receipts shown, newest first. */
export const RECEIPTS_SHOWN = 6;

export type ReceiptSnapshot = StepSnapshot & { depth: number };

export type ReviewMeasures = {
  /** Steps finished in the window. */
  exits: number;
  /** Typical time a step takes, start to finish, weighted by exits; null below MIN_BASELINE_EXITS. */
  stepDwellMs: number | null;
  /** Σ process ÷ Σ dwell over the window's finished steps; null below MIN_BASELINE_EXITS. */
  flowEfficiency: number | null;
};

export type FlowReviewReceipt = {
  /** The review point, YYYY-MM-DD. */
  reviewedOn: string;
  current: ReviewMeasures;
  bottleneck: { stageKey: string; title: string; roomsHeld: number; waitMs: number | null; cause: string | null } | null;
};

export type FlowReviewHistory = {
  /** First day of the version's stage data and the day its baseline ends, YYYY-MM-DD. */
  baselineFrom: string;
  baselineTo: string;
  baseline: ReviewMeasures;
  /** The first review point after the baseline, YYYY-MM-DD; the receipts start here. */
  firstReviewOn: string;
  receipts: FlowReviewReceipt[];
} | null;

const day = (at: Date) => at.toISOString().slice(0, 10);

function measure(rows: readonly StepSnapshot[]): ReviewMeasures {
  let exits = 0;
  let dwell = 0;
  let process = 0;
  let paired = 0;
  for (const row of rows) {
    if (row.throughput <= 0 || row.cycleP50Ms == null) continue;
    exits += row.throughput;
    dwell += row.cycleP50Ms * row.throughput;
    if (row.processP50Ms != null) {
      process += Math.min(row.processP50Ms, row.cycleP50Ms) * row.throughput;
      paired += row.cycleP50Ms * row.throughput;
    }
  }
  if (exits < MIN_BASELINE_EXITS) return { exits, stepDwellMs: null, flowEfficiency: null };
  return { exits, stepDwellMs: dwell / exits, flowEfficiency: paired > 0 ? process / paired : null };
}

/** Where rooms are held now and why most of them are, per step: the latest review's cause. */
export function liveStageHolds(rooms: readonly { current: DriveObservation | null }[]): StageHold[] {
  const byStage = new Map<string, Map<string, number>>();
  for (const { current: obs } of rooms) {
    if (!obs?.action || !obs.reason || !obs.stageKey) continue;
    const classified = classifyDriveSegment({ action: obs.action, reason: obs.reason });
    if (classified?.state !== "awaiting-person" && classified?.state !== "blocked") continue;
    const cause = classified.state === "awaiting-person" ? "awaiting-person" : (holdCauseTag(classified.cause, obs.detail) ?? "blocked");
    const causes = byStage.get(obs.stageKey) ?? new Map<string, number>();
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
    byStage.set(obs.stageKey, causes);
  }
  return [...byStage].map(([stageKey, causes]) => ({
    stageKey,
    roomsHeld: [...causes.values()].reduce((sum, n) => sum + n, 0),
    cause: [...causes.entries()].sort((a, b) => b[1] - a[1])[0]![0],
  }));
}

export function computeFlowReviewHistory(input: {
  shapeRef: string;
  stages: readonly { key: string; title: string }[];
  /** Every daily snapshot of this shape version's stage queues. */
  snapshots: readonly ReceiptSnapshot[];
  everyDays: number;
  /** Where rooms are held now, for the latest review's cause. */
  liveHolds?: readonly StageHold[];
  now: Date;
}): FlowReviewHistory {
  const keyOf = new Map(input.stages.map((stage) => [workroomStageQueueKey(input.shapeRef, stage.key), stage]));
  const rows = input.snapshots.filter((row) => keyOf.has(row.queueKey));
  if (rows.length === 0 || !(input.everyDays > 0)) return null;
  const firstDay = rows.reduce((min, row) => (row.period < min ? row.period : min), rows[0]!.period);
  const start = new Date(`${firstDay}T00:00:00Z`);
  const baselineEnd = new Date(start.getTime() + BASELINE_DAYS * DAY_MS);
  const inWindow = (from: Date, to: Date) => rows.filter((row) => row.period >= day(from) && row.period < day(to));

  // A review before the baseline is complete has nothing to compare with.
  const firstReview = new Date(start.getTime() + Math.max(1, Math.ceil(BASELINE_DAYS / input.everyDays)) * input.everyDays * DAY_MS);
  const reviewDays: Date[] = [];
  for (let at = firstReview; at.getTime() <= input.now.getTime(); at = new Date(at.getTime() + input.everyDays * DAY_MS)) reviewDays.push(at);
  const shown = reviewDays.slice(-RECEIPTS_SHOWN).reverse();

  const receipts = shown.map((at, index): FlowReviewReceipt => {
    const window = inWindow(new Date(at.getTime() - FLOW_WINDOW_DAYS * DAY_MS), at);
    const piles = [...keyOf].map(([queueKey, stage]) => {
      const stageRows = window.filter((row) => row.queueKey === queueKey);
      const latest = stageRows.reduce<ReceiptSnapshot | null>((last, row) => (!last || row.period > last.period ? row : last), null);
      return { stageKey: stage.key, title: stage.title, roomsHeld: latest?.depth ?? 0, waitMs: typicalStepWaitMs(stageRows) };
    });
    const top = topByWaitTimesQueue(piles);
    // Snapshots carry no cause; the latest review borrows it from the live holds.
    const cause = index === 0 && top ? input.liveHolds?.find((hold) => hold.stageKey === top.stageKey)?.cause ?? null : null;
    return { reviewedOn: day(at), current: measure(window), bottleneck: top ? { ...top, cause } : null };
  });

  return { baselineFrom: firstDay, baselineTo: day(baselineEnd), baseline: measure(inWindow(start, baselineEnd)), firstReviewOn: day(firstReview), receipts };
}
