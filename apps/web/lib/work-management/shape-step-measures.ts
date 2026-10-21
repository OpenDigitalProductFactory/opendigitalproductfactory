/**
 * Where a shape's time goes, step by step (BI-C5CD9EAE, EP-B70E718D F4).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md
 * §4 (Lean VSM data box, inventory triangle, timeline ladder; Camunda-style
 * heat) and §7 L2.
 *
 * Pure. Reads the per-stage daily QueueMetricSnapshot rows F2 writes and the
 * live counts the drill-in already loads; no new store.
 *
 *  - A step's typical times are its daily P50s weighted by exits (throughput)
 *    over the window. Below MIN_BASELINE_EXITS a step is "too few to measure",
 *    never a number.
 *  - Wait is dwell minus process, so a step's two ladder segments always add
 *    up to its dwell.
 *  - Heat compares the last HEAT_RECENT_DAYS with the step's own window
 *    baseline; both sides need MIN_BASELINE_EXITS, and only a change of at
 *    least HEAT_FACTOR either way is marked.
 */
import { FLOW_WINDOW_DAYS } from "./portfolio-flow";
import { MIN_BASELINE_EXITS } from "./workroom-flow-map";
import { workroomStageQueueKey } from "./workroom-stage-telemetry";

export const HEAT_RECENT_DAYS = 7;
/** Recent dwell at least this many times the baseline is hotter; at most its inverse is cooler. */
export const HEAT_FACTOR = 1.25;

const DAY_MS = 24 * 60 * 60 * 1000;

export type StepSnapshot = {
  queueKey: string;
  period: string;
  throughput: number;
  cycleP50Ms: number | null;
  processP50Ms: number | null;
  firstPassYield: number | null;
};

export type StepHeat = {
  direction: "hotter" | "cooler" | "steady";
  recentDwellMs: number;
  baselineDwellMs: number;
};

export type StepMeasures = {
  key: string;
  title: string;
  /** Rooms at the step now; depth is the ones not being worked (the inventory triangle). */
  queue: { wip: number; depth: number };
  /** Exits (finished passes) in the window. */
  exits: number;
  dwellMs: number | null;
  processMs: number | null;
  waitMs: number | null;
  firstPassYield: number | null;
  heat: StepHeat | null;
};

export type TimelineLadder = {
  steps: { key: string; processMs: number; waitMs: number }[];
  processMs: number;
  waitMs: number;
  /** Σ process ÷ Σ dwell over the measured steps. */
  flowEfficiency: number;
  /** Steps left off the ladder for too few exits. */
  unmeasured: number;
};

export type ShapeStepMeasures = { steps: StepMeasures[]; ladder: TimelineLadder | null };

type Weighted = { exits: number; dwell: number; process: number; processExits: number; fpy: number; fpyExits: number };

function weigh(rows: readonly StepSnapshot[]): Weighted {
  const w: Weighted = { exits: 0, dwell: 0, process: 0, processExits: 0, fpy: 0, fpyExits: 0 };
  for (const row of rows) {
    if (row.throughput <= 0 || row.cycleP50Ms == null) continue;
    w.exits += row.throughput;
    w.dwell += row.cycleP50Ms * row.throughput;
    if (row.processP50Ms != null) {
      w.process += row.processP50Ms * row.throughput;
      w.processExits += row.throughput;
    }
    if (row.firstPassYield != null) {
      w.fpy += row.firstPassYield * row.throughput;
      w.fpyExits += row.throughput;
    }
  }
  return w;
}

/** A step's typical wait over its snapshots (dwell − process), or null when it is too few to measure. */
export function typicalStepWaitMs(rows: readonly StepSnapshot[]): number | null {
  const w = weigh(rows);
  if (w.exits < MIN_BASELINE_EXITS || w.processExits === 0) return null;
  const dwellMs = w.dwell / w.exits;
  return dwellMs - Math.min(dwellMs, w.process / w.processExits);
}

/**
 * The pile where the most waiting accrues: rooms held × the step's typical
 * wait (spec §8, Lean VSM). A step too few to measure is never ranked on a
 * guessed wait; only when no held step is measured does rooms held decide.
 */
export function topByWaitTimesQueue<T extends { roomsHeld: number; waitMs: number | null }>(piles: readonly T[]): T | null {
  const held = piles.filter((pile) => pile.roomsHeld > 0);
  const measured = held.filter((pile) => pile.waitMs != null);
  const score = measured.length > 0 ? (pile: T) => pile.roomsHeld * pile.waitMs! : (pile: T) => pile.roomsHeld;
  let top: T | null = null;
  for (const pile of measured.length > 0 ? measured : held) {
    if (!top || score(pile) > score(top) || (score(pile) === score(top) && pile.roomsHeld > top.roomsHeld)) top = pile;
  }
  return top;
}

export function computeShapeStepMeasures(input: {
  shapeRef: string;
  stages: readonly { key: string; title: string }[];
  snapshots: readonly StepSnapshot[];
  liveCounts: ReadonlyMap<string, { wip: number; depth: number }>;
  now: Date;
}): ShapeStepMeasures {
  const windowStart = new Date(input.now.getTime() - FLOW_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const recentStart = new Date(input.now.getTime() - HEAT_RECENT_DAYS * DAY_MS).toISOString().slice(0, 10);

  const steps = input.stages.map((stage): StepMeasures => {
    const queueKey = workroomStageQueueKey(input.shapeRef, stage.key);
    const rows = input.snapshots.filter((s) => s.queueKey === queueKey && s.period >= windowStart);
    const all = weigh(rows);
    const queue = input.liveCounts.get(queueKey) ?? { wip: 0, depth: 0 };
    if (all.exits < MIN_BASELINE_EXITS) {
      return { key: stage.key, title: stage.title, queue, exits: all.exits, dwellMs: null, processMs: null, waitMs: null, firstPassYield: null, heat: null };
    }
    const dwellMs = all.dwell / all.exits;
    const processMs = all.processExits > 0 ? Math.min(dwellMs, all.process / all.processExits) : null;
    const recent = weigh(rows.filter((s) => s.period >= recentStart));
    let heat: StepHeat | null = null;
    if (recent.exits >= MIN_BASELINE_EXITS) {
      const recentDwellMs = recent.dwell / recent.exits;
      const ratio = recentDwellMs / dwellMs;
      heat = {
        direction: ratio >= HEAT_FACTOR ? "hotter" : ratio <= 1 / HEAT_FACTOR ? "cooler" : "steady",
        recentDwellMs,
        baselineDwellMs: dwellMs,
      };
    }
    return {
      key: stage.key,
      title: stage.title,
      queue,
      exits: all.exits,
      dwellMs,
      processMs,
      waitMs: processMs == null ? null : dwellMs - processMs,
      firstPassYield: all.fpyExits > 0 ? all.fpy / all.fpyExits : null,
      heat,
    };
  });

  const laddered = steps.filter((s): s is StepMeasures & { processMs: number; waitMs: number; dwellMs: number } => s.processMs != null && s.waitMs != null && s.dwellMs != null);
  if (laddered.length === 0) return { steps, ladder: null };
  const processMs = laddered.reduce((sum, s) => sum + s.processMs, 0);
  const waitMs = laddered.reduce((sum, s) => sum + s.waitMs, 0);
  const dwellMs = laddered.reduce((sum, s) => sum + s.dwellMs, 0);
  return {
    steps,
    ladder: {
      steps: laddered.map((s) => ({ key: s.key, processMs: s.processMs, waitMs: s.waitMs })),
      processMs,
      waitMs,
      flowEfficiency: dwellMs > 0 ? processMs / dwellMs : 0,
      unmeasured: steps.length - laddered.length,
    },
  };
}
