// apps/web/lib/tak/thread-cost-ledger-runner.ts
// Server-side query for the per-thread / per-effort spend rollup (BI-CCF1ACBB).
// Runs the indexed groupBy over AdapterRunTelemetry + ToolExecution and folds the
// results with the pure summarizer. Kept separate from the pure core so the fold
// stays DB-free for unit tests.

import { prisma } from "@dpf/db";
import {
  summarizeThreadSpend,
  combineThreadSpend,
  type SpendRow,
  type ThreadSpend,
} from "./thread-cost-ledger";

async function loadSpendRows(threadIds: string[]): Promise<SpendRow[]> {
  if (threadIds.length === 0) return [];
  const [inference, tools] = await Promise.all([
    prisma.adapterRunTelemetry.findMany({
      where: { threadId: { in: threadIds } },
      select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true },
    }),
    prisma.toolExecution.findMany({
      where: { threadId: { in: threadIds } },
      select: { inputTokens: true, outputTokens: true, costUsd: true },
    }),
  ]);
  const rows: SpendRow[] = [];
  for (const r of inference) {
    rows.push({
      source: "inference",
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      // estimatedCostUsd is a Prisma Decimal | null.
      costUsd: r.estimatedCostUsd != null ? Number(r.estimatedCostUsd) : null,
    });
  }
  for (const r of tools) {
    rows.push({
      source: "tool",
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
    });
  }
  return rows;
}

/** Cumulative spend for a single coworker thread. */
export async function getThreadSpend(threadId: string): Promise<ThreadSpend> {
  return summarizeThreadSpend(await loadSpendRows([threadId]));
}

/**
 * Cumulative spend for an effort spanning many threads (e.g. a shared
 * multi-coworker effort — BI-23A65B81). Aggregates all threads at once.
 */
export async function getEffortSpend(threadIds: string[]): Promise<ThreadSpend> {
  return summarizeThreadSpend(await loadSpendRows(threadIds));
}

/** Per-thread breakdown for an effort, plus the combined total. */
export async function getEffortSpendBreakdown(
  threadIds: string[],
): Promise<{ perThread: Record<string, ThreadSpend>; total: ThreadSpend }> {
  const perThread: Record<string, ThreadSpend> = {};
  for (const id of threadIds) {
    perThread[id] = await getThreadSpend(id);
  }
  return { perThread, total: combineThreadSpend(Object.values(perThread)) };
}
