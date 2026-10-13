/** Shared bounded history reader for the existing room-locked lifecycle transaction. */
export interface CycleHistoryCursor { id: string; createdAt: Date }
export interface CycleHistoryPageQuery { after: CycleHistoryCursor | null; take: number }

export class CycleHistoryBudgetError extends Error {
  readonly reason = "cycle_history_budget_exceeded";
  constructor(readonly after: CycleHistoryCursor) {
    super("Cycle history exceeds 1,000 records; reconcile the history before retrying this lifecycle mutation.");
    this.name = "CycleHistoryBudgetError";
  }
}

export async function readCycleHistory<T extends CycleHistoryCursor>(
  readPage: (query: CycleHistoryPageQuery) => Promise<T[]>,
): Promise<T[]> {
  const result: T[] = [];
  let after: CycleHistoryCursor | null = null;
  for (;;) {
    // One lookahead row distinguishes an exactly-full history from truncation.
    const take = Math.min(200, 1_001 - result.length);
    const page = await readPage({ after, take });
    if (page.length > take) throw new Error("Cycle history adapter exceeded its page limit.");
    for (const row of page) {
      if (!Number.isFinite(row.createdAt.getTime()) || !row.id
        || (after && (row.createdAt < after.createdAt
          || (row.createdAt.getTime() === after.createdAt.getTime() && row.id <= after.id)))) {
        throw new Error("Cycle history cursor did not advance.");
      }
      if (result.length === 1_000) throw new CycleHistoryBudgetError(after!);
      result.push(row);
      after = { id: row.id, createdAt: row.createdAt };
    }
    if (page.length < take) return result;
  }
}

export function cycleHistoryAfter(after: CycleHistoryCursor | null) {
  return after ? { OR: [
    { createdAt: { gt: after.createdAt } },
    { createdAt: after.createdAt, id: { gt: after.id } },
  ] } : {};
}
