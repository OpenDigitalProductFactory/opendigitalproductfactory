import { describe, expect, it } from "vitest";

import { buildWaitingList, wholeDaysWaiting, type WaitingListSource } from "./adoption-waiting-list";

const now = new Date("2026-09-03T10:00:00.000Z");

function animal(id: string, overrides: Partial<WaitingListSource> = {}): WaitingListSource {
  return {
    id, name: id, species: "dog", breed: null, status: "available",
    publishedAt: new Date("2026-08-01T00:00:00.000Z"), ...overrides,
  };
}

describe("buildWaitingList (BI-899D7F00)", () => {
  it("orders the longest wait first", () => {
    const list = buildWaitingList([
      animal("Biscuit", { publishedAt: new Date("2026-08-20T00:00:00.000Z") }),
      animal("Ada", { publishedAt: new Date("2026-06-01T00:00:00.000Z") }),
      animal("Coco", { publishedAt: new Date("2026-08-01T00:00:00.000Z") }),
    ], now);
    expect(list.rows.map((r) => r.name)).toEqual(["Ada", "Coco", "Biscuit"]);
    expect(list.rows.map((r) => r.daysWaiting)).toEqual([94, 33, 14]);
  });

  it("counts whole calendar days, so late yesterday is one day and this morning is zero", () => {
    expect(wholeDaysWaiting(new Date("2026-09-02T23:30:00.000Z"), now)).toBe(1);
    expect(wholeDaysWaiting(new Date("2026-09-03T01:00:00.000Z"), now)).toBe(0);
    expect(wholeDaysWaiting(new Date("2026-09-01T00:00:00.000Z"), now)).toBe(2);
  });

  it("puts a future listing date last with no day count, never a negative number", () => {
    const list = buildWaitingList([
      animal("Future", { publishedAt: new Date("2026-09-10T00:00:00.000Z") }),
      animal("Ada"),
    ], now);
    expect(list.rows.map((r) => r.name)).toEqual(["Ada", "Future"]);
    expect(list.rows[1]).toMatchObject({ dateState: "future", daysWaiting: null, listedOn: null });
  });

  it("shows an animal with no listing date last rather than hiding it, after any future-dated one", () => {
    const list = buildWaitingList([
      animal("NoDate", { publishedAt: null }),
      animal("Future", { publishedAt: new Date("2026-09-10T00:00:00.000Z") }),
      animal("Ada"),
    ], now);
    expect(list.rows.map((r) => r.name)).toEqual(["Ada", "Future", "NoDate"]);
    expect(list.rows[2]).toMatchObject({ dateState: "missing", daysWaiting: null });
  });

  it("includes every currently listed species: filtering to dog and cat could hide the longest wait", () => {
    const list = buildWaitingList([
      animal("Rex", { species: "dog", publishedAt: new Date("2026-08-15T00:00:00.000Z") }),
      animal("Thumper", { species: "rabbit", publishedAt: new Date("2026-05-01T00:00:00.000Z") }),
      animal("Mittens", { species: "cat", publishedAt: new Date("2026-07-01T00:00:00.000Z") }),
    ], now);
    expect(list.rows.map((r) => `${r.name}:${r.species}`)).toEqual(["Thumper:rabbit", "Mittens:cat", "Rex:dog"]);
  });

  it("lists only animals still available: hold, pending and adopted are not waiting", () => {
    const list = buildWaitingList([
      animal("Held", { status: "hold" }),
      animal("Pending", { status: "pending" }),
      animal("Gone", { status: "adopted" }),
      animal("Ada"),
    ], now);
    expect(list.rows.map((r) => r.name)).toEqual(["Ada"]);
    expect(list.listedCount).toBe(1);
  });

  it("caps at the 100 longest-waiting and says so, keeping the count of all listed", () => {
    const many = Array.from({ length: 103 }, (_, i) =>
      animal(`A${String(i).padStart(3, "0")}`, { publishedAt: new Date(Date.UTC(2026, 0, 1 + i)) }));
    const list = buildWaitingList(many, now);
    expect(list.rows).toHaveLength(100);
    expect(list.capped).toBe(true);
    expect(list.listedCount).toBe(103);
    // The three left off are the three most recently listed.
    expect(list.rows.map((r) => r.name)).not.toContain("A102");
    expect(list.rows[0]!.name).toBe("A000");
  });

  it("does not claim a cap when the list fits", () => {
    const list = buildWaitingList([animal("Ada")], now, 100);
    expect(list.capped).toBe(false);
  });

  it("breaks same-day ties by name so the order is stable week to week", () => {
    const list = buildWaitingList([animal("Zed"), animal("Amy")], now);
    expect(list.rows.map((r) => r.name)).toEqual(["Amy", "Zed"]);
  });
});
