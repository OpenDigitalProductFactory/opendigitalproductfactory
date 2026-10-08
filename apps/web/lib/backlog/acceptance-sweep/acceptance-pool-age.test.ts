import { describe, expect, it, vi } from "vitest";

import {
  acceptanceAgeBand,
  acceptanceAgeDays,
  loadAcceptancePoolAges,
  summarizePoolAge,
} from "./acceptance-pool-age";

// AC-S2-3 / AC-AA-06 (docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md
// §3.2, §5): every run measures the whole pool's age from state entry, so the
// over-30-day trend is recorded by the platform rather than asserted. Age comes
// only from S1's acceptanceEnteredAt; updatedAt is never read.

const NOW = new Date("2026-10-06T05:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("acceptance age bands", () => {
  it("counts whole days in the state", () => {
    expect(acceptanceAgeDays(daysAgo(0), NOW)).toBe(0);
    expect(acceptanceAgeDays(new Date(NOW.getTime() - 86_399_000), NOW)).toBe(0);
    expect(acceptanceAgeDays(daysAgo(14), NOW)).toBe(14);
  });

  it("bands at 7, 14 (aged) and 30 (trend) days", () => {
    expect(acceptanceAgeBand(0)).toBe("under-7d");
    expect(acceptanceAgeBand(6)).toBe("under-7d");
    expect(acceptanceAgeBand(7)).toBe("7-14d");
    expect(acceptanceAgeBand(13)).toBe("7-14d");
    expect(acceptanceAgeBand(14)).toBe("14-30d");
    expect(acceptanceAgeBand(30)).toBe("14-30d");
    expect(acceptanceAgeBand(31)).toBe("over-30d");
  });
});

describe("loadAcceptancePoolAges", () => {
  it("ages every awaiting item from its latest entry, or from createdAt marked as such, never from updatedAt", async () => {
    const poison = (row: Record<string, unknown>) => Object.defineProperty(row, "updatedAt", {
      enumerable: true,
      get() {
        throw new Error("updatedAt must never be read as acceptance age");
      },
    });
    const items = [
      poison({ id: "row-a", itemId: "BI-A", createdAt: daysAgo(90) }),
      poison({ id: "row-b", itemId: "BI-B", createdAt: daysAgo(45) }),
    ];
    const db = {
      backlogItem: { findMany: vi.fn().mockResolvedValue(items) },
      backlogItemActivity: {
        findMany: vi.fn().mockResolvedValue([
          { backlogItemId: "row-a", recordedAt: daysAgo(20), payload: { from: "in-progress", to: "awaiting-acceptance" } },
          { backlogItemId: "row-a", recordedAt: daysAgo(3), payload: { from: "awaiting-acceptance", to: "awaiting-acceptance" } },
          { backlogItemId: "row-a", recordedAt: daysAgo(5), payload: { from: "open", to: "awaiting-acceptance" } },
        ]),
      },
    };

    const ages = await loadAcceptancePoolAges(db, NOW);

    expect(ages.get("row-a")).toEqual({ rowId: "row-a", itemId: "BI-A", enteredAt: daysAgo(5), ageBasis: "entry", ageDays: 5 });
    expect(ages.get("row-b")).toEqual({ rowId: "row-b", itemId: "BI-B", enteredAt: daysAgo(45), ageBasis: "created", ageDays: 45 });
    expect(db.backlogItem.findMany).toHaveBeenCalledWith({
      where: { status: "awaiting-acceptance" },
      select: { id: true, itemId: true, createdAt: true },
    });
    expect(db.backlogItemActivity.findMany).toHaveBeenCalledWith({
      where: {
        kind: "status_change",
        payload: { path: ["to"], equals: "awaiting-acceptance" },
        backlogItem: { status: "awaiting-acceptance" },
      },
      select: { backlogItemId: true, recordedAt: true, payload: true },
    });
    expect(JSON.stringify([db.backlogItem.findMany.mock.calls, db.backlogItemActivity.findMany.mock.calls])).not.toContain("updatedAt");
  });
});

describe("summarizePoolAge", () => {
  it("counts bands, aged, the over-30 trend and the created-basis upper bounds", () => {
    const ages = [
      { ageDays: 2, ageBasis: "entry" as const },
      { ageDays: 9, ageBasis: "entry" as const },
      { ageDays: 14, ageBasis: "entry" as const },
      { ageDays: 31, ageBasis: "created" as const },
      { ageDays: 120, ageBasis: "created" as const },
    ];
    expect(summarizePoolAge(ages, { agedDays: 14, trendDays: 30 })).toEqual({
      size: 5,
      ageBands: { "under-7d": 1, "7-14d": 1, "14-30d": 1, "over-30d": 2 },
      aged: 3,
      agedOverTrend: 2,
      trendDays: 30,
      ageBasisCreated: 2,
      oldestAgeDays: 120,
    });
  });

  it("reports an empty pool as zeroes", () => {
    expect(summarizePoolAge([], { agedDays: 14, trendDays: 30 })).toEqual({
      size: 0,
      ageBands: { "under-7d": 0, "7-14d": 0, "14-30d": 0, "over-30d": 0 },
      aged: 0,
      agedOverTrend: 0,
      trendDays: 30,
      ageBasisCreated: 0,
      oldestAgeDays: null,
    });
  });
});
