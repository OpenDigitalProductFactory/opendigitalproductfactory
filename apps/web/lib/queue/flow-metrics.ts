// apps/web/lib/queue/flow-metrics.ts
//
// EP-3516E23D Phase 1 — the ONE canonical flow-metric registry every queue in
// the platform (scarce-compute admission lanes AND human-speed work queues)
// derives its numbers from. Spec: docs/superpowers/specs/
// 2026-07-06-reusable-queueing-substrate-design.md §4.1.
//
// This module is PURE (no DB, no clock, no I/O): it defines the closed vocab of
// queue transitions/outcomes/metric keys and the math that turns a stream of
// per-item timestamps into wait/process/cycle time and the aggregate flow
// metrics. Keeping the definitions in one pure place is the whole point — tiles,
// MCP tools, and the rollup aggregator can never drift apart on what "cycle
// time" or "first-pass yield" means.

/**
 * The closed set of lifecycle transitions any queued item emits. A queue is a
 * defect if it never emits these — unmeasured queues are how bottlenecks hide.
 *
 *  - enqueued:  item entered the queue (wait clock starts)
 *  - started:   a worker/lane began serving it (wait ends, process begins)
 *  - finished:  served to a terminal outcome (process ends, cycle ends)
 *  - cancelled: abandoned/expired while queued or in progress (balk/renege)
 *  - requeued:  returned to the queue for rework — breaks first-pass yield
 *  - held:      the item stopped moving for a reason outside the worker — it
 *               waits on a person or is blocked (the lane key carries why)
 *  - released:  the hold ended
 *
 * `held` / `released` exist for items whose time interleaves work and waiting,
 * such as a Workroom stage (EP-B70E718D F2). A queue that never emits them is
 * measured exactly as before.
 */
export const QUEUE_TRANSITIONS = [
  "enqueued",
  "started",
  "finished",
  "cancelled",
  "requeued",
  "held",
  "released",
] as const;
export type QueueTransition = (typeof QUEUE_TRANSITIONS)[number];

/** Terminal outcome recorded on a `finished` (or `cancelled`) transition. */
export const QUEUE_OUTCOMES = ["success", "failed", "cancelled"] as const;
export type QueueOutcome = (typeof QUEUE_OUTCOMES)[number];

/**
 * Canonical metric keys — the shared vocabulary a tile, MCP tool, or snapshot
 * row refers to. Definitions (spec §4.1):
 *  - wait_ms:          startedAt − enqueuedAt          (queue time)
 *  - process_ms:       finishedAt − startedAt          (touch time)
 *  - cycle_ms:         finishedAt − enqueuedAt          (lead time through queue)
 *  - depth:            count(status = queued) at observation (WIP-waiting)
 *  - wip:              count(queued + in-progress)      (work in process)
 *  - arrival_rate:     enqueued per period              (demand)
 *  - throughput:       finished per period              (flow rate)
 *  - first_pass_yield: finished OK without rework ÷ finished (FPY / % correct)
 *  - sla_attainment:   finished within SLA ÷ finished (where SLA set)
 *  - abandonment_rate: cancelled while queued ÷ enqueued
 *  - utilization:      busy time ÷ available time per lane
 */
export const FLOW_METRIC_KEYS = [
  "wait_ms",
  "process_ms",
  "cycle_ms",
  "depth",
  "wip",
  "arrival_rate",
  "throughput",
  "first_pass_yield",
  "sla_attainment",
  "abandonment_rate",
  "utilization",
] as const;
export type FlowMetricKey = (typeof FLOW_METRIC_KEYS)[number];

/**
 * A single item's reconstructed timeline. Every field is optional because an
 * item may be observed mid-flight (enqueued but not started) or a lane may only
 * emit part of the lifecycle (e.g. a compute lane that records started/finished
 * but no explicit enqueue). The math below degrades gracefully to `null` for
 * any duration whose endpoints are not both present.
 */
export interface QueueItemTimeline {
  enqueuedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  cancelledAt?: Date | null;
  outcome?: QueueOutcome | null;
  /** Times the item was returned to the queue for rework. */
  requeueCount?: number;
  /** SLA deadline for this item, if the queue sets one. */
  slaDueAt?: Date | null;
  /**
   * Spans the item spent held (waiting on a person, or blocked). Present only
   * for items that emit `held` / `released`. An open span has `to: null` and is
   * closed at the item's terminal time when it has one.
   */
  heldSpans?: readonly { from: Date; to: Date | null }[];
}

export interface FlowDurations {
  waitMs: number | null;
  processMs: number | null;
  cycleMs: number | null;
  /** Total held time within the item's life. Null for items with no hold spans. */
  heldMs: number | null;
}

function diffMs(later: Date | null | undefined, earlier: Date | null | undefined): number | null {
  if (!later || !earlier) return null;
  const ms = later.getTime() - earlier.getTime();
  // Guard against clock skew / out-of-order events producing negatives.
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function overlapMs(span: { from: Date; to: Date | null }, start: Date, end: Date): number {
  const from = Math.max(span.from.getTime(), start.getTime());
  const to = Math.min((span.to ?? end).getTime(), end.getTime());
  return to > from ? to - from : 0;
}

/**
 * Wait / process / cycle for one item. Pure; null where endpoints are absent.
 *
 * For an item that records holds, time is not one wait followed by one
 * service: work and waiting interleave. Process (touch) time is then the
 * started→finished span minus the time held inside it, and wait is everything
 * else in the cycle — the value-stream reading of "wait" (spec 2026-10-02
 * §5.2). Items without holds keep the original definitions.
 */
export function computeFlowDurations(t: QueueItemTimeline): FlowDurations {
  const terminal = t.finishedAt ?? t.cancelledAt ?? null;
  const cycleMs = diffMs(terminal, t.enqueuedAt);
  if (!t.heldSpans) {
    return {
      waitMs: diffMs(t.startedAt, t.enqueuedAt),
      processMs: diffMs(t.finishedAt, t.startedAt),
      cycleMs,
      heldMs: null,
    };
  }
  const end = terminal;
  const heldMs = t.enqueuedAt && end
    ? t.heldSpans.reduce((sum, span) => sum + overlapMs(span, t.enqueuedAt!, end), 0)
    : null;
  const serviceMs = diffMs(t.finishedAt, t.startedAt);
  const heldInServiceMs = t.startedAt && t.finishedAt
    ? t.heldSpans.reduce((sum, span) => sum + overlapMs(span, t.startedAt!, t.finishedAt!), 0)
    : 0;
  // A finished step that was only ever held (a person's decision, a blockage)
  // had no touch time: zero, not unknown — otherwise it drops out of flow
  // efficiency and makes the stream look more efficient than it is.
  const processMs = serviceMs == null
    ? (t.finishedAt && !t.startedAt ? 0 : null)
    : Math.max(0, serviceMs - heldInServiceMs);
  return {
    waitMs: cycleMs != null && processMs != null ? Math.max(0, cycleMs - processMs) : diffMs(t.startedAt, t.enqueuedAt),
    processMs,
    cycleMs,
    heldMs,
  };
}

/**
 * First-pass success: finished with a `success` outcome AND never requeued for
 * rework. This is the "% correct" the operator asked for — a completion that
 * needed a second bite does not count toward yield.
 */
export function isFirstPassSuccess(t: QueueItemTimeline): boolean {
  return t.outcome === "success" && (t.requeueCount ?? 0) === 0;
}

/** Whether a finished item met its SLA (only meaningful when slaDueAt is set). */
export function metSla(t: QueueItemTimeline): boolean | null {
  if (!t.slaDueAt || !t.finishedAt) return null;
  return t.finishedAt.getTime() <= t.slaDueAt.getTime();
}

/**
 * Nearest-rank percentile over a numeric sample. Returns null for an empty
 * sample. `p` in [0,1]. Rounds the result to an integer (ms).
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, p));
  const rank = Math.ceil(clamped * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return Math.round(sorted[idx]!);
}

export interface QueueSnapshotSummary {
  arrivals: number;
  throughput: number;
  waitP50Ms: number | null;
  waitP95Ms: number | null;
  processP50Ms: number | null;
  processP95Ms: number | null;
  cycleP50Ms: number | null;
  cycleP95Ms: number | null;
  /** 0..1, null when nothing finished in the window. */
  firstPassYield: number | null;
  /** 0..1, null when no finished item carried an SLA. */
  slaAttainment: number | null;
  /** 0..1, null when nothing arrived in the window. */
  abandonmentRate: number | null;
  /** Held time of items finished in the window; null when none recorded holds. */
  heldP50Ms: number | null;
  heldP95Ms: number | null;
  /**
   * Σ process ÷ Σ cycle over items finished in the window with both — the
   * queue's flow efficiency (value-add ratio). Null when not computable.
   */
  processShare: number | null;
}

/** Half-open window [start, end) the summary counts events in. */
export interface QueueWindow {
  start: Date;
  end: Date;
}

/**
 * Aggregate a set of item timelines observed within a period into the queue's
 * flow-metric summary. Pure — the caller supplies the items (already filtered
 * to the window) and this computes the numbers. Depth/WIP are point-in-time and
 * supplied separately by the caller (they are not derivable from a window).
 *
 * Counting rules (window-scoped):
 *  - arrivals   = items whose enqueuedAt is in the window
 *  - throughput = items whose finishedAt is in the window
 *  - percentiles are over the items that have the relevant duration defined
 *  - firstPassYield = firstPassSuccess ÷ finished-in-window
 *  - slaAttainment  = metSla ÷ finished-in-window-with-SLA
 *  - abandonmentRate = cancelled-in-window ÷ arrivals
 */
export function summarizeQueueWindow(
  items: readonly QueueItemTimeline[],
  window?: QueueWindow,
): QueueSnapshotSummary {
  const waits: number[] = [];
  const processes: number[] = [];
  const cycles: number[] = [];
  const helds: number[] = [];
  let processSum = 0;
  let cycleSum = 0;

  // Items may carry history from before the window (a multi-day stage), so an
  // event counts only when it happened inside the window. Without a window the
  // caller has already filtered, as before.
  const inWindow = (at: Date | null | undefined): boolean =>
    !!at && (!window || (at.getTime() >= window.start.getTime() && at.getTime() < window.end.getTime()));

  let arrivals = 0;
  let finished = 0;
  let firstPass = 0;
  let cancelled = 0;
  let slaEligible = 0;
  let slaMet = 0;

  for (const it of items) {
    if (inWindow(it.enqueuedAt)) arrivals += 1;
    if (inWindow(it.cancelledAt)) cancelled += 1;

    const d = computeFlowDurations(it);
    const finishedHere = inWindow(it.finishedAt);
    // Holds make wait/process meaningful only once the item has left the
    // stage; plain queues keep their original per-event counting.
    if (!it.heldSpans || finishedHere) {
      if (d.waitMs != null) waits.push(d.waitMs);
      if (d.processMs != null) processes.push(d.processMs);
    }

    if (finishedHere) {
      finished += 1;
      if (d.cycleMs != null) cycles.push(d.cycleMs);
      if (d.heldMs != null) helds.push(d.heldMs);
      if (d.cycleMs != null && d.processMs != null) {
        processSum += d.processMs;
        cycleSum += d.cycleMs;
      }
      if (isFirstPassSuccess(it)) firstPass += 1;
      const sla = metSla(it);
      if (sla != null) {
        slaEligible += 1;
        if (sla) slaMet += 1;
      }
    }
  }

  return {
    arrivals,
    throughput: finished,
    waitP50Ms: percentile(waits, 0.5),
    waitP95Ms: percentile(waits, 0.95),
    processP50Ms: percentile(processes, 0.5),
    processP95Ms: percentile(processes, 0.95),
    cycleP50Ms: percentile(cycles, 0.5),
    cycleP95Ms: percentile(cycles, 0.95),
    firstPassYield: finished > 0 ? firstPass / finished : null,
    slaAttainment: slaEligible > 0 ? slaMet / slaEligible : null,
    abandonmentRate: arrivals > 0 ? cancelled / arrivals : null,
    heldP50Ms: percentile(helds, 0.5),
    heldP95Ms: percentile(helds, 0.95),
    processShare: cycleSum > 0 ? processSum / cycleSum : null,
  };
}

/** Day-grain period key ("YYYY-MM-DD", UTC) — mirrors SkillMetric (subject,period). */
export function queueMetricPeriod(at: Date): string {
  return at.toISOString().slice(0, 10);
}
