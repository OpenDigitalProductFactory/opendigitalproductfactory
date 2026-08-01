// apps/web/lib/tak/context-trace-health.ts
//
// Reads the per-turn arbitration traces persisted by BI-3E218D80 and answers the
// question that made them worth persisting: IS CONTEXT BEING STARVED, AND WHERE.
//
// WHY THIS EXISTS. #3790 made the arbitration decision durable, but a record nothing
// looks at is just a slower thermometer. The founder approved that work "for debugging
// and optimization purposes", and neither is served by a column no surface reads. This
// is the read half.
//
// WHAT IT CAN AND CANNOT SAY. It reports what the arbitrator DID: how often a turn lost
// something, which sources lost most, and how full the budget ran. It cannot say whether
// the loss mattered — that needs the answer the coworker gave, which is a human
// judgement. So every label here is about the decision, never about quality: "dropped on
// 12% of turns", not "degraded 12% of answers". Overstating this would rebuild the
// attestation problem in a dashboard.
//
// Pure by construction — no Prisma, no I/O, no Date — so the aggregation is unit-tested
// directly and the loader stays a thin query.

import type { ArbitrationTrace, ArbitrationTraceEntry } from "./arbitration-trace";

/** One source's share of the loss across the sampled turns. */
export type SourceLoss = {
  source: string;
  /** Turns on which this source was dropped entirely. */
  droppedTurns: number;
  /** Turns on which its compressed fallback was substituted instead. */
  compressedTurns: number;
  /** Tokens that never reached the model because this source was dropped. */
  droppedTokens: number;
};

export type ContextTraceHealth = {
  /** Turns sampled — traces only exist for turns that actually arbitrated. */
  turns: number;
  /** Turns where at least one source was dropped or compressed. */
  turnsWithLoss: number;
  /** turnsWithLoss / turns, 3dp. 0 when there are no turns. */
  lossRate: number;
  /** Mean budgetUtilization across sampled turns, 3dp. >1 means over budget. */
  meanUtilization: number;
  /** Turns that ran at or over their budget ceiling. */
  turnsAtCeiling: number;
  /** Per-source loss, worst first. Only sources that actually lost something. */
  losses: SourceLoss[];
  /** Model tiers seen, with their turn counts — loss reads differently per tier. */
  byTier: { modelTier: string; turns: number; turnsWithLoss: number }[];
};

/** A trace row as it comes back from the database: unknown until validated. */
export type StoredTrace = unknown;

/**
 * Narrow an untrusted JSON column to a trace we can aggregate.
 *
 * The column is nullable and versioned, and rows written before a future shape change
 * will still be there. Validating rather than casting means an old or malformed row is
 * SKIPPED and counted, instead of silently corrupting an average that an operator is
 * about to make a decision from.
 */
export function parseStoredTrace(value: StoredTrace): ArbitrationTrace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const t = value as Partial<ArbitrationTrace>;
  if (t.version !== 1) return null;
  if (typeof t.totalTokens !== "number" || typeof t.budgetUtilization !== "number") return null;
  if (!Array.isArray(t.selected) || !Array.isArray(t.dropped)) return null;
  if (typeof t.modelTier !== "string") return null;
  return t as ArbitrationTrace;
}

function bump(map: Map<string, SourceLoss>, source: string): SourceLoss {
  let row = map.get(source);
  if (!row) {
    row = { source, droppedTurns: 0, compressedTurns: 0, droppedTokens: 0 };
    map.set(source, row);
  }
  return row;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Aggregate raw trace rows into the health projection.
 *
 * Rows that fail validation are ignored rather than guessed at; `turns` counts only what
 * was actually understood, so a rate is never computed over rows we could not read.
 */
export function summarizeContextTraces(rows: readonly StoredTrace[]): ContextTraceHealth {
  const losses = new Map<string, SourceLoss>();
  const tiers = new Map<string, { turns: number; turnsWithLoss: number }>();
  let turns = 0;
  let turnsWithLoss = 0;
  let turnsAtCeiling = 0;
  let utilizationTotal = 0;

  for (const raw of rows) {
    const trace = parseStoredTrace(raw);
    if (!trace) continue;

    turns += 1;
    utilizationTotal += trace.budgetUtilization;
    if (trace.budgetUtilization >= 1) turnsAtCeiling += 1;

    const compressed = trace.selected.filter((s: ArbitrationTraceEntry) => s.usedCompressed === true);
    const lost = trace.dropped.length > 0 || compressed.length > 0;
    if (lost) turnsWithLoss += 1;

    for (const d of trace.dropped) {
      const row = bump(losses, d.source);
      row.droppedTurns += 1;
      row.droppedTokens += Number.isFinite(d.tokenCount) ? d.tokenCount : 0;
    }
    for (const c of compressed) {
      bump(losses, c.source).compressedTurns += 1;
    }

    const tier = tiers.get(trace.modelTier) ?? { turns: 0, turnsWithLoss: 0 };
    tier.turns += 1;
    if (lost) tier.turnsWithLoss += 1;
    tiers.set(trace.modelTier, tier);
  }

  return {
    turns,
    turnsWithLoss,
    lossRate: turns === 0 ? 0 : round3(turnsWithLoss / turns),
    meanUtilization: turns === 0 ? 0 : round3(utilizationTotal / turns),
    turnsAtCeiling,
    // Worst first: a source dropped outright outranks one merely compressed, and ties
    // break on tokens lost, because that is the size of what the model never saw.
    losses: [...losses.values()].sort(
      (a, b) =>
        b.droppedTurns - a.droppedTurns ||
        b.droppedTokens - a.droppedTokens ||
        b.compressedTurns - a.compressedTurns ||
        a.source.localeCompare(b.source),
    ),
    byTier: [...tiers.entries()]
      .map(([modelTier, v]) => ({ modelTier, ...v }))
      .sort((a, b) => b.turns - a.turns || a.modelTier.localeCompare(b.modelTier)),
  };
}

/**
 * One plain sentence for an operator who will not read a table.
 *
 * Deliberately reports the DECISION, not a verdict on answer quality — see the module
 * header. "No turns have recorded a trace yet" is a distinct, honest state: it means
 * nothing arbitrated in the sample, not that nothing was lost.
 */
export function describeContextTraceHealth(health: ContextTraceHealth): string {
  if (health.turns === 0) return "No turns in this sample recorded a context-arbitration trace yet.";
  if (health.turnsWithLoss === 0) {
    return `All ${health.turns} sampled turns fitted their context budget with nothing dropped or compressed.`;
  }
  const pct = Math.round(health.lossRate * 100);
  const worst = health.losses[0];
  const worstPart = worst
    ? ` Most affected: ${worst.source} (dropped on ${worst.droppedTurns}, compressed on ${worst.compressedTurns}).`
    : "";
  return `${health.turnsWithLoss} of ${health.turns} sampled turns (${pct}%) lost context to the budget.${worstPart}`;
}
