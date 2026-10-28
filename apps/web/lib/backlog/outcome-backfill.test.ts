import { describe, expect, it } from "vitest";

import { backfillBacklogItemOutcomes, type OutcomeBackfillDb } from "./outcome-backfill";

// BI-8DE5429B: open items filed before the outcome field get one through the
// same derivation intake uses, in bounded, idempotent runs.

type Row = {
  id: string; title: string; body: string | null; workType: string | null; status: string;
  outcome: string | null; outcomeSource: string | null; updatedAt: Date; createdAt: Date;
};

function fakeDb(rows: Row[]) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const open = (row: Row, where: { status: { in: string[] } }) => row.outcome === null && where.status.in.includes(row.status);
  const db: OutcomeBackfillDb = {
    backlogItem: {
      findMany: async (args) => {
        const { where, take } = args as { where: { status: { in: string[] } }; take: number };
        return rows.filter((row) => open(row, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, take);
      },
      updateMany: async (args) => {
        const { where, data } = args as { where: { id: string; outcome: null }; data: Record<string, unknown> };
        updates.push({ where, data });
        const row = rows.find((entry) => entry.id === where.id && entry.outcome === null);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      count: async (args) => rows.filter((row) => open(row, (args as { where: { status: { in: string[] } } }).where)).length,
    },
  };
  return { db, updates };
}

const t = (n: number) => new Date(Date.UTC(2026, 9, n));
const row = (id: string, overrides: Partial<Row> = {}): Row => ({
  id, title: `Item ${id}`, body: null, workType: "feature", status: "open",
  outcome: null, outcomeSource: null, updatedAt: t(20), createdAt: t(Number(id.replace(/\D/g, "")) || 1), ...overrides,
});

describe("backfillBacklogItemOutcomes", () => {
  it("lifts a written Outcome section as stated and derives the rest, leaving updatedAt untouched", async () => {
    const rows = [
      row("r1", { body: "## Outcome\nFinance sees overdue invoices." }),
      row("r2", { title: "Save fails", workType: "bug" }),
    ];
    const { db, updates } = fakeDb(rows);

    const result = await backfillBacklogItemOutcomes(db);

    expect(result).toEqual({ filled: 2, bySource: { stated: 1, derived: 1 }, alreadyFilled: 0, remaining: 0 });
    expect(rows[0]).toMatchObject({ outcome: "Finance sees overdue invoices.", outcomeSource: "stated" });
    expect(rows[1]).toMatchObject({ outcome: 'The reported problem no longer happens: "Save fails".', outcomeSource: "derived" });
    expect(updates.every((update) => (update.data.updatedAt as Date).getTime() === t(20).getTime())).toBe(true);
  });

  it("is bounded per run and reports what remains", async () => {
    const rows = [row("r1"), row("r2"), row("r3")];
    const { db } = fakeDb(rows);

    expect(await backfillBacklogItemOutcomes(db, { limit: 2 })).toMatchObject({ filled: 2, remaining: 1 });
    expect(await backfillBacklogItemOutcomes(db, { limit: 2 })).toMatchObject({ filled: 1, remaining: 0 });
    expect(await backfillBacklogItemOutcomes(db, { limit: 2 })).toMatchObject({ filled: 0, remaining: 0 });
  });

  it("never overwrites an outcome, and skips delivered and retired items", async () => {
    const rows = [
      row("r1", { outcome: "Stated by a person.", outcomeSource: "stated" }),
      row("r2", { status: "done" }),
      row("r3", { status: "retired" }),
    ];
    const { db, updates } = fakeDb(rows);

    expect(await backfillBacklogItemOutcomes(db)).toMatchObject({ filled: 0, remaining: 0 });
    expect(updates).toHaveLength(0);
    expect(rows[0]!.outcome).toBe("Stated by a person.");
  });
});
