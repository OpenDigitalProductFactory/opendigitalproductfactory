// BI-8DE5429B: open backlog items filed before the outcome was a field get
// one through the SAME derivation intake uses (resolveItemOutcome): an
// Outcome section the filer wrote is lifted as stated, otherwise a draft is
// derived and marked derived. A bounded job, not hand SQL: each run fills at
// most `limit` items, and each write is a compare-and-set on `outcome IS
// NULL`, so overlapping or retried runs never overwrite anything.
//
// The fill does not touch updatedAt: it is a projection of what the item
// already says, not an edit, so recency ordering and work-sync versions stay
// as they were.

import { resolveItemOutcome, type OutcomeSource } from "./intake-outcome";

/** Statuses whose items are still to be delivered: every one owes an outcome. */
export const OUTCOME_BACKFILL_STATUSES = ["triaging", "open", "in-progress", "awaiting-acceptance", "blocked", "deferred"] as const;

export const OUTCOME_BACKFILL_BATCH = 250;

type BackfillRow = {
  id: string; title: string; body: string | null; workType: string | null; updatedAt: Date;
};

export type OutcomeBackfillDb = {
  backlogItem: {
    findMany(args: unknown): Promise<BackfillRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
    count(args: unknown): Promise<number>;
  };
};

export type OutcomeBackfillResult = {
  filled: number;
  bySource: Record<OutcomeSource, number>;
  /** Rows another writer filled first. */
  alreadyFilled: number;
  /** Open items still without an outcome after this run. */
  remaining: number;
};

export async function backfillBacklogItemOutcomes(
  db: OutcomeBackfillDb,
  input: { limit?: number } = {},
): Promise<OutcomeBackfillResult> {
  const where = { outcome: null, status: { in: [...OUTCOME_BACKFILL_STATUSES] } };
  const rows = await db.backlogItem.findMany({
    where,
    select: { id: true, title: true, body: true, workType: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? OUTCOME_BACKFILL_BATCH,
  });
  const result: OutcomeBackfillResult = { filled: 0, bySource: { stated: 0, derived: 0 }, alreadyFilled: 0, remaining: 0 };
  for (const row of rows) {
    const resolved = resolveItemOutcome(row);
    const written = await db.backlogItem.updateMany({
      where: { id: row.id, outcome: null },
      data: { outcome: resolved.outcome, outcomeSource: resolved.outcomeSource, updatedAt: row.updatedAt },
    });
    if (written.count === 1) {
      result.filled += 1;
      result.bySource[resolved.outcomeSource] += 1;
    } else {
      result.alreadyFilled += 1;
    }
  }
  result.remaining = await db.backlogItem.count({ where });
  return result;
}
