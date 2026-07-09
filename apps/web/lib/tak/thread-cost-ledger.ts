// apps/web/lib/tak/thread-cost-ledger.ts
// Per-thread (and per-effort) cumulative token/cost rollup — BI-CCF1ACBB
// (EP-8C706944 Phase 1).
//
// Raw spend already lives in two well-indexed tables: AdapterRunTelemetry
// (per-inference-run inputTokens/outputTokens/estimatedCostUsd, joined to
// threadId) and ToolExecution (per-tool-call inputTokens/outputTokens/costUsd,
// joined to threadId). What was missing is a cumulative rollup — endless threads
// had per-turn metrics but no "how much has this conversation cost" total, so
// spend was bounded only by the provider window.
//
// This module derives the rollup rather than denormalizing a counter that could
// drift (single-source-of-truth): the pure `summarizeThreadSpend` folds the two
// row sources into one ThreadSpend, and the server runner runs the indexed
// groupBy. Admins read it for visibility; the runtime reads it to make
// compaction/consolidation spend-aware.

/** One contributor to a thread's spend (an inference run or a tool call). */
export type SpendRow = {
  source: "inference" | "tool";
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

export type ThreadSpend = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  inferenceRuns: number;
  toolCalls: number;
};

export const EMPTY_THREAD_SPEND: ThreadSpend = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  inferenceRuns: 0,
  toolCalls: 0,
};

/**
 * Fold raw spend rows (from both sources) into one cumulative ThreadSpend.
 * Pure — no DB, no rounding surprises: costs are summed as-is and null
 * token/cost fields count as zero.
 */
export function summarizeThreadSpend(rows: SpendRow[]): ThreadSpend {
  const acc = { ...EMPTY_THREAD_SPEND };
  for (const r of rows) {
    acc.inputTokens += r.inputTokens ?? 0;
    acc.outputTokens += r.outputTokens ?? 0;
    acc.costUsd += r.costUsd ?? 0;
    if (r.source === "inference") acc.inferenceRuns += 1;
    else acc.toolCalls += 1;
  }
  acc.totalTokens = acc.inputTokens + acc.outputTokens;
  return acc;
}

/** Sum several thread rollups into one effort-level total. */
export function combineThreadSpend(spends: ThreadSpend[]): ThreadSpend {
  const acc = { ...EMPTY_THREAD_SPEND };
  for (const s of spends) {
    acc.inputTokens += s.inputTokens;
    acc.outputTokens += s.outputTokens;
    acc.costUsd += s.costUsd;
    acc.inferenceRuns += s.inferenceRuns;
    acc.toolCalls += s.toolCalls;
  }
  acc.totalTokens = acc.inputTokens + acc.outputTokens;
  return acc;
}

/** Human-readable one-line rollup for admin display / spend-aware prompts. */
export function formatThreadSpend(spend: ThreadSpend): string {
  const cost = spend.costUsd >= 0.01 ? `$${spend.costUsd.toFixed(2)}` : `$${spend.costUsd.toFixed(4)}`;
  return `${spend.totalTokens.toLocaleString()} tokens (${spend.inputTokens.toLocaleString()} in / ${spend.outputTokens.toLocaleString()} out), ${cost} across ${spend.inferenceRuns} inference run${spend.inferenceRuns === 1 ? "" : "s"} + ${spend.toolCalls} tool call${spend.toolCalls === 1 ? "" : "s"}`;
}
