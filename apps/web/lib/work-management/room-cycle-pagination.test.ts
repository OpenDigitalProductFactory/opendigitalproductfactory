import { describe, expect, it, vi } from "vitest";
import { readCycleHistory, CycleHistoryBudgetError, type CycleHistoryPageQuery } from "./room-cycle-pagination";

const rows = Array.from({ length: 1_001 }, (_, n) => ({
  id: `row-${String(n).padStart(5, "0")}`, createdAt: new Date("2026-10-07T12:00:00Z"),
}));

describe("bounded cycle history", () => {
  it("pages equal timestamps by stable identity without dropping rows", async () => {
    const read = vi.fn(async ({ after, take }: CycleHistoryPageQuery) => rows.slice(0, 999).filter(r => !after || r.id > after.id).slice(0, take));
    const result = await readCycleHistory(read);
    expect(result).toEqual(rows.slice(0, 999));
    expect(read.mock.calls.every(([query]) => query.take <= 200)).toBe(true);
    expect(read.mock.calls.length).toBe(5);
  });

  it("refuses an incomplete mutation view instead of treating truncation as no active cycle", async () => {
    const read = vi.fn(async ({ after, take }: CycleHistoryPageQuery) => rows.filter(r => !after || r.id > after.id).slice(0, take));
    await expect(readCycleHistory(read)).rejects.toBeInstanceOf(CycleHistoryBudgetError);
    expect(read.mock.calls.reduce((sum, [query]) => sum + query.take, 0)).toBeLessThanOrEqual(1_001);
  });

  it("accepts an exactly full history only after a bounded end check", async () => {
    const read = vi.fn(async ({ after, take }: CycleHistoryPageQuery) => rows.slice(0, 1_000).filter(r => !after || r.id > after.id).slice(0, take));
    expect(await readCycleHistory(read)).toHaveLength(1_000);
    expect(read.mock.calls.at(-1)?.[0].take).toBe(1);
  });

  it("rejects a non-advancing adapter rather than looping", async () => {
    await expect(readCycleHistory(async () => rows.slice(0, 200))).rejects.toThrow("advance");
  });
});
