// apps/web/lib/tak/arbitration-trace.ts
//
// BI-3E218D80 — the persisted arbitration trace. Extends EP-CTX-001 §9 (Observability)
// with the one thing that section never specified: a PER-TURN record of what the coworker
// was actually given and what was dropped for budget.
//
// WHY THIS EXISTS. `arbitrate()` decides what enters every coworker's system prompt.
// Until now that decision was `console.log(formatArbitrationLog(...))` and nothing else —
// `ArbitrationResult.dropped` had exactly one consumer, a debug-string formatter. So when
// a coworker behaved as if it did not know something, there was no way to distinguish:
//
//   1. the fact was never retrieved,
//   2. it was retrieved and DROPPED for budget,
//   3. it was present and the model ignored it.
//
// Those need three different fixes and were indistinguishable from outside. This is also
// the diagnostic the local-model cascade (BI-F4D3B9E9) needed and did not have.
//
// EP-CTX-001 §9.1 specified aggregate Prometheus counters (`contextSourcesDropped` et al.)
// which were never built. Aggregates are the wrong instrument for this question anyway: a
// counter cannot answer "why didn't THIS coworker know X on THIS turn". Hence a per-turn
// row, not a metric.
//
// LABELS AND COUNTS ONLY — NEVER CONTENT. This is the load-bearing rule of the module and
// the reason it is a separate pure function rather than a JSON.stringify at the call site.
// Every `ContextSource` carries `content`, and that content is recalled user facts, page
// data, and semantic-memory excerpts. It is ALREADY persisted in the message row and its
// source tables; copying it here would balloon the column and create a second retention
// surface for the same sensitive text, governed by nothing. The trace records that a source
// participated and what it cost — enough to reconstruct the decision, insufficient to leak
// the payload.

import type { ArbitrationResult, ContextBudget, ContextSource, ContextTier } from "./context-arbitrator";

/** One source's participation in a single arbitration. No content, by contract. */
export type ArbitrationTraceEntry = {
  source: string;
  tier: ContextTier;
  tokenCount: number;
  /** True when `arbitrate` substituted the compressed fallback to make this fit. */
  usedCompressed?: true;
};

export type ArbitrationTrace = {
  /** Schema version, so a reader can tell an old row from a new one. */
  version: 1;
  modelTier: string;
  budget: { total: number; l0: number; l1: number; l2: number };
  totalTokens: number;
  /** totalTokens / budget.total, rounded to 3dp. >1 means over budget. */
  budgetUtilization: number;
  selected: ArbitrationTraceEntry[];
  dropped: ArbitrationTraceEntry[];
};

/**
 * The one place a `ContextSource` is narrowed for persistence.
 *
 * `content`, `compressedContent`, `compressible`, and `priority` are deliberately absent:
 * the first two are the payload this module exists to keep out of the database, and the
 * latter two describe the INPUT policy rather than the outcome — they are recoverable from
 * the code, so persisting them per turn would be noise.
 */
function toEntry(src: ContextSource): ArbitrationTraceEntry {
  const entry: ArbitrationTraceEntry = {
    source: src.source,
    tier: src.tier,
    tokenCount: src.tokenCount,
  };
  // Only present when true, so the common case stays compact in the column.
  if (src.usedCompressed) entry.usedCompressed = true;
  return entry;
}

/**
 * Build the persistable trace for one arbitration. Pure — no I/O, no Date, no randomness —
 * so it is unit-testable and safe to call on every turn.
 */
export function buildArbitrationTrace(
  result: ArbitrationResult,
  budget: ContextBudget,
): ArbitrationTrace {
  return {
    version: 1,
    modelTier: budget.modelTier,
    budget: {
      total: budget.totalBudget,
      l0: budget.l0Budget,
      l1: budget.l1Budget,
      l2: budget.l2Budget,
    },
    totalTokens: result.totalTokens,
    // Round rather than store a 17-digit float; 3dp keeps 0.1% resolution, which is far
    // finer than the ~4-chars-per-token estimate feeding it.
    budgetUtilization: Math.round(result.budgetUtilization * 1000) / 1000,
    selected: result.selected.map(toEntry),
    dropped: result.dropped.map(toEntry),
  };
}

/**
 * Was anything sacrificed on this turn? The cheap predicate a reader or alert wants,
 * without re-deriving it from the arrays.
 */
export function traceHasLoss(trace: ArbitrationTrace): boolean {
  return trace.dropped.length > 0 || trace.selected.some((s) => s.usedCompressed === true);
}
