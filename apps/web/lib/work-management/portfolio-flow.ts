/**
 * How each portfolio's work flows (BI-0FB4A049, EP-B70E718D F5).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §5.2, §5.4, §7 (L1).
 *
 * The same five measures for every portfolio, so the four compare:
 *
 *   flow load        rooms in flow now (being worked, waiting on a person, or blocked)
 *   flow time        a run's first step entered → its last step finished (median)
 *   flow efficiency  Σ touch time ÷ Σ time in steps, over steps finished in the window
 *   throughput       runs that reached a success stop, per week
 *   cost             points from the investment read model (AI spend joins with F6)
 *
 * A run is one pass through a shape: a claim room's whole life, or one cycle of
 * a standing room (the stage telemetry's item id is `<capsuleId>:<cycleKey>`).
 *
 * Rooms with no portfolio are their own bucket, never folded into another.
 * Pure: rooms and stage telemetry in, numbers out.
 */
import { computeFlowDurations, percentile } from "@/lib/queue/flow-metrics";
import { reconstructTimelines, type QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";
import { PORTFOLIO_ROLES, isPortfolioRole, type PortfolioRoleKey } from "@/lib/portfolio/portfolio-role";

import { classifyDriveSegment } from "./workroom-flow-state";
import { holdCauseTag, type DriveObservation } from "./workroom-stage-telemetry";

const DAY_MS = 24 * 60 * 60 * 1000;
export const FLOW_WINDOW_DAYS = 28;
export const TREND_WEEKS = 8;

/** Flow Framework item types (spec §5.4), mapped from shape family. */
export const FLOW_ITEM_TYPES = ["feature", "defect", "risk", "debt"] as const;
export type FlowItemType = (typeof FLOW_ITEM_TYPES)[number];

const RISK = /(security|credential|policy|licen[cs]e|advisory|incident|detection|alert)/;
const DEBT = /(conformance|hygiene|estate|drift|architecture|alignment)/;

/** Orchestration rooms coordinate other rooms and are left out of the mix (null). */
export function shapeItemType(shapeKey: string): FlowItemType | null {
  if (shapeKey.endsWith("-orchestration") || shapeKey.startsWith("cross-cutting-") || /^(evaluate|explore|integrate|deploy|release|consume|operate|governance)-stream/.test(shapeKey)) return null;
  if (shapeKey === "delivery-break-fix") return "defect";
  if (shapeKey.startsWith("delivery-")) return "feature";
  if (RISK.test(shapeKey)) return "risk";
  if (DEBT.test(shapeKey)) return "debt";
  return "feature";
}

export type PortfolioFlowRoom = {
  capsuleId: string;
  portfolioRole: string | null;
  shapeRef: string | null;
  current: DriveObservation | null;
};

export type ShapeFlowRow = {
  shapeKey: string;
  shapeRef: string;
  roomsInFlow: number;
  flowTimeP50Ms: number | null;
  runs: number;
  /** The step holding the most rooms right now, and why most of them are held. */
  bottleneck: { stageKey: string; roomsHeld: number; cause: string } | null;
};

export type PortfolioFlow = {
  key: PortfolioRoleKey | "unplaced";
  rooms: number;
  flowLoad: number;
  flowTime: { p50Ms: number | null; priorP50Ms: number | null; runs: number };
  flowEfficiency: { value: number | null; prior: number | null };
  throughput: { perWeek: number; priorPerWeek: number };
  /** Median flow time of runs finished in each of the last TREND_WEEKS weeks, oldest first. */
  weeklyFlowTimeP50Ms: (number | null)[];
  /** Rooms in flow by item type. */
  distribution: Record<FlowItemType, number>;
  shapes: ShapeFlowRow[];
};

type Run = { capsuleId: string; startedAt: Date; endedAt: Date | null; success: boolean };

function runsFrom(rows: readonly QueueTelemetryRow[]): Map<string, Run> {
  const byItem = new Map<string, QueueTelemetryRow[]>();
  for (const row of rows) {
    const list = byItem.get(row.itemId);
    if (list) list.push(row);
    else byItem.set(row.itemId, [row]);
  }
  const runs = new Map<string, Run>();
  for (const [itemId, itemRows] of byItem) {
    const ordered = [...itemRows].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const first = ordered.find((row) => row.transition === "enqueued");
    const last = ordered.at(-1)!;
    if (!first) continue;
    // A run is over when its newest event finishes a step and nothing re-opened.
    const ended = last.transition === "finished";
    runs.set(itemId, {
      capsuleId: itemId.split(":")[0]!,
      startedAt: first.occurredAt,
      endedAt: ended ? last.occurredAt : null,
      success: ended && last.outcome !== "failed",
    });
  }
  return runs;
}

const inRange = (at: Date | null, from: Date, to: Date) => !!at && at.getTime() >= from.getTime() && at.getTime() < to.getTime();

export function computePortfolioFlow(input: {
  rooms: readonly PortfolioFlowRoom[];
  rows: readonly QueueTelemetryRow[];
  now: Date;
}): PortfolioFlow[] {
  const { now } = input;
  const windowStart = new Date(now.getTime() - FLOW_WINDOW_DAYS * DAY_MS);
  const priorStart = new Date(now.getTime() - 2 * FLOW_WINDOW_DAYS * DAY_MS);
  const bucketOf = (role: string | null): PortfolioFlow["key"] => (isPortfolioRole(role) ? role : "unplaced");
  const roomBucket = new Map(input.rooms.map((room) => [room.capsuleId, bucketOf(room.portfolioRole)]));
  const roomShape = new Map(input.rooms.map((room) => [room.capsuleId, room.shapeRef]));

  const keys: PortfolioFlow["key"][] = [...PORTFOLIO_ROLES, "unplaced"];
  const out = new Map<PortfolioFlow["key"], PortfolioFlow>(keys.map((key) => [key, {
    key,
    rooms: 0,
    flowLoad: 0,
    flowTime: { p50Ms: null, priorP50Ms: null, runs: 0 },
    flowEfficiency: { value: null, prior: null },
    throughput: { perWeek: 0, priorPerWeek: 0 },
    weeklyFlowTimeP50Ms: Array.from({ length: TREND_WEEKS }, () => null),
    distribution: { feature: 0, defect: 0, risk: 0, debt: 0 },
    shapes: [],
  }]));

  // Live: load, mix, and where each shape's rooms sit now.
  const shapeAcc = new Map<string, { bucket: PortfolioFlow["key"]; shapeRef: string; inFlow: number; held: Map<string, { n: number; causes: Map<string, number> }> }>();
  for (const room of input.rooms) {
    const bucket = out.get(bucketOf(room.portfolioRole))!;
    bucket.rooms += 1;
    const classified = room.current?.action && room.current.reason
      ? classifyDriveSegment({ action: room.current.action, reason: room.current.reason })
      : null;
    const inFlow = classified && (classified.state === "working" || classified.state === "awaiting-person" || classified.state === "blocked");
    if (!inFlow || !room.shapeRef) continue;
    bucket.flowLoad += 1;
    const shapeKey = room.shapeRef.split("@")[0]!;
    const itemType = shapeItemType(shapeKey);
    if (itemType) bucket.distribution[itemType] += 1;
    const accKey = `${bucket.key}\x00${room.shapeRef}`;
    const acc = shapeAcc.get(accKey) ?? { bucket: bucket.key, shapeRef: room.shapeRef, inFlow: 0, held: new Map() };
    acc.inFlow += 1;
    if (classified.state !== "working" && room.current?.stageKey) {
      const stage = acc.held.get(room.current.stageKey) ?? { n: 0, causes: new Map() };
      stage.n += 1;
      const cause = classified.state === "awaiting-person" ? "awaiting-person" : (holdCauseTag(classified.cause, room.current?.detail) ?? "blocked");
      stage.causes.set(cause, (stage.causes.get(cause) ?? 0) + 1);
      acc.held.set(room.current.stageKey, stage);
    }
    shapeAcc.set(accKey, acc);
  }

  // History: runs and steps from stage telemetry.
  const runs = runsFrom(input.rows);
  const runsByBucket = new Map<PortfolioFlow["key"], Run[]>();
  for (const run of runs.values()) {
    const bucket = roomBucket.get(run.capsuleId);
    if (!bucket) continue;
    const list = runsByBucket.get(bucket);
    if (list) list.push(run);
    else runsByBucket.set(bucket, [run]);
  }
  const shapeRunTimes = new Map<string, number[]>();
  for (const run of runs.values()) {
    if (!inRange(run.endedAt, windowStart, now)) continue;
    const bucket = roomBucket.get(run.capsuleId);
    const shapeRef = roomShape.get(run.capsuleId);
    if (!bucket || !shapeRef) continue;
    const key = `${bucket}\x00${shapeRef}`;
    const list = shapeRunTimes.get(key);
    const ms = run.endedAt!.getTime() - run.startedAt.getTime();
    if (list) list.push(ms);
    else shapeRunTimes.set(key, [ms]);
  }

  const stepCapsule = (itemId: string) => itemId.split("\x00")[1]!.split(":")[0]!;
  const efficiency = new Map<PortfolioFlow["key"], { now: [number, number]; prior: [number, number] }>();
  const stepRows = new Map<string, QueueTelemetryRow[]>();
  for (const row of input.rows) {
    const key = `${row.queueKey}\x00${row.itemId}`;
    const list = stepRows.get(key);
    if (list) list.push(row);
    else stepRows.set(key, [row]);
  }
  for (const [key, rowsForStep] of stepRows) {
    const [timeline] = reconstructTimelines(rowsForStep);
    if (!timeline?.finishedAt) continue;
    const bucket = roomBucket.get(stepCapsule(key));
    if (!bucket) continue;
    const durations = computeFlowDurations(timeline);
    if (durations.cycleMs == null || durations.processMs == null) continue;
    const entry = efficiency.get(bucket) ?? { now: [0, 0], prior: [0, 0] };
    const slot = inRange(timeline.finishedAt, windowStart, now) ? entry.now : inRange(timeline.finishedAt, priorStart, windowStart) ? entry.prior : null;
    if (!slot) continue;
    slot[0] += durations.processMs;
    slot[1] += durations.cycleMs;
    efficiency.set(bucket, entry);
  }

  for (const [key, flow] of out) {
    const bucketRuns = runsByBucket.get(key) ?? [];
    const durationsIn = (from: Date, to: Date) => bucketRuns
      .filter((run) => inRange(run.endedAt, from, to))
      .map((run) => run.endedAt!.getTime() - run.startedAt.getTime());
    const current = durationsIn(windowStart, now);
    flow.flowTime = { p50Ms: percentile(current, 0.5), priorP50Ms: percentile(durationsIn(priorStart, windowStart), 0.5), runs: current.length };
    const successIn = (from: Date, to: Date) => bucketRuns.filter((run) => run.success && inRange(run.endedAt, from, to)).length;
    flow.throughput = {
      perWeek: successIn(windowStart, now) / (FLOW_WINDOW_DAYS / 7),
      priorPerWeek: successIn(priorStart, windowStart) / (FLOW_WINDOW_DAYS / 7),
    };
    flow.weeklyFlowTimeP50Ms = Array.from({ length: TREND_WEEKS }, (_, i) => {
      const to = new Date(now.getTime() - (TREND_WEEKS - 1 - i) * 7 * DAY_MS);
      return percentile(durationsIn(new Date(to.getTime() - 7 * DAY_MS), to), 0.5);
    });
    const eff = efficiency.get(key);
    flow.flowEfficiency = {
      value: eff && eff.now[1] > 0 ? eff.now[0] / eff.now[1] : null,
      prior: eff && eff.prior[1] > 0 ? eff.prior[0] / eff.prior[1] : null,
    };
  }

  for (const [accKey, acc] of shapeAcc) {
    let bottleneck: ShapeFlowRow["bottleneck"] = null;
    for (const [stageKey, stage] of acc.held) {
      if (!bottleneck || stage.n > bottleneck.roomsHeld) {
        const cause = [...stage.causes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
        bottleneck = { stageKey, roomsHeld: stage.n, cause };
      }
    }
    const times = shapeRunTimes.get(accKey) ?? [];
    out.get(acc.bucket)!.shapes.push({
      shapeKey: acc.shapeRef.split("@")[0]!,
      shapeRef: acc.shapeRef,
      roomsInFlow: acc.inFlow,
      flowTimeP50Ms: percentile(times, 0.5),
      runs: times.length,
      bottleneck,
    });
  }
  for (const flow of out.values()) flow.shapes.sort((a, b) => b.roomsInFlow - a.roomsInFlow || a.shapeKey.localeCompare(b.shapeKey));

  return keys.map((key) => out.get(key)!);
}
