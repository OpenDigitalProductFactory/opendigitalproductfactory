import { describe, expect, it, vi } from "vitest";

import {
  ACCEPTANCE_AGED_DAYS,
  agedAcceptanceShare,
  describeAgedShare,
  formatAgedCount,
  type AgeBasis,
} from "./aged-acceptance";
import { loadAgedAcceptanceItems, type AgedAcceptanceDb } from "./aged-acceptance-loader";

const now = new Date("2026-09-25T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function entryRow(backlogItemId: string, recordedAt: Date, from = "in-progress") {
  return { backlogItemId, kind: "status_change", recordedAt, payload: { from, to: "awaiting-acceptance" } };
}

function fakeDb(rows: ReturnType<typeof entryRow>[]) {
  const findMany = vi.fn(async (_args: unknown) => rows);
  return { db: { backlogItemActivity: { findMany } } as unknown as AgedAcceptanceDb, findMany };
}

describe("ACCEPTANCE_AGED_DAYS", () => {
  it("is two weekly delivery review points", () => {
    expect(ACCEPTANCE_AGED_DAYS).toBe(14);
  });
});

describe("loadAgedAcceptanceItems", () => {
  it("reads every awaiting item's entry activity in one query and ages from entry, not creation", async () => {
    const { db, findMany } = fakeDb([
      entryRow("fresh", daysAgo(3)),
      entryRow("stale", daysAgo(20)),
      entryRow("stale", daysAgo(15)),
    ]);

    const aged = await loadAgedAcceptanceItems(db, [
      // Created long ago, entered 3 days ago: not aged.
      { id: "fresh", status: "awaiting-acceptance", createdAt: daysAgo(90) },
      { id: "stale", status: "awaiting-acceptance", createdAt: daysAgo(90) },
      { id: "done", status: "done", createdAt: daysAgo(90) },
    ], now);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        backlogItemId: { in: ["fresh", "stale"] },
        kind: "status_change",
        payload: { path: ["to"], equals: "awaiting-acceptance" },
      },
    });
    expect(aged).toEqual([{ id: "stale", ageBasis: "entry" }]);
  });

  it("falls back to creation, marked, when an item has no entry row", async () => {
    const { db } = fakeDb([]);

    const aged = await loadAgedAcceptanceItems(db, [
      { id: "old", status: "awaiting-acceptance", createdAt: daysAgo(30) },
      { id: "new", status: "awaiting-acceptance", createdAt: daysAgo(2) },
    ], now);

    expect(aged).toEqual([{ id: "old", ageBasis: "created" }]);
  });

  it("counts an item aged exactly at the threshold", async () => {
    const { db } = fakeDb([entryRow("edge", daysAgo(ACCEPTANCE_AGED_DAYS))]);

    const aged = await loadAgedAcceptanceItems(db, [
      { id: "edge", status: "awaiting-acceptance", createdAt: daysAgo(60) },
    ], now);

    expect(aged).toEqual([{ id: "edge", ageBasis: "entry" }]);
  });

  it("does not query when nothing awaits acceptance", async () => {
    const { db, findMany } = fakeDb([]);

    const aged = await loadAgedAcceptanceItems(db, [{ id: "d", status: "done", createdAt: daysAgo(40) }], now);

    expect(aged).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("agedAcceptanceShare", () => {
  it("counts awaiting and aged separately from done", () => {
    const agedById = new Map<string, AgeBasis>([["a1", "entry"], ["a2", "created"], ["d1", "entry"]]);

    const share = agedAcceptanceShare([
      { id: "a1", status: "awaiting-acceptance" },
      { id: "a2", status: "awaiting-acceptance" },
      { id: "a3", status: "awaiting-acceptance" },
      { id: "d1", status: "done" },
    ], agedById);

    expect(share).toEqual({ awaiting: 3, aged: 2, agedByCreation: 1 });
  });
});

describe("formatAgedCount and describeAgedShare", () => {
  it("shows an exact count when every age is measured from entry", () => {
    expect(formatAgedCount({ aged: 4, agedByCreation: 0 })).toBe("4");
    expect(describeAgedShare({ aged: 4, agedByCreation: 0 })).toBe(
      "4 waiting 14+ days since entering awaiting acceptance.",
    );
  });

  it("marks the count as a ceiling when some ages come from creation", () => {
    expect(formatAgedCount({ aged: 4, agedByCreation: 1 })).toBe("up to 4");
    expect(describeAgedShare({ aged: 4, agedByCreation: 1 })).toContain(
      "1 of them have no recorded entry, so their age is counted from creation and may be lower.",
    );
  });
});
