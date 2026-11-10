import { describe, expect, it } from "vitest";

import { quarterBounds } from "./investment-points";
import { isActivelyInProgress, resolveInvestmentItem, summarizePortfolioInvestment, type InvestmentItemRow } from "./investment-read-model";

const now = new Date("2026-09-25T12:00:00Z");

function row(overrides: Partial<InvestmentItemRow>): InvestmentItemRow {
  return {
    itemId: "BI-1", status: "open", effortSize: "medium", jobSize: null, estimateAgreed: null,
    storedPortfolioId: null, storedPortfolioDangling: false, productPortfolioId: null, taxonomyPortfolioId: null,
    coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null, hasActiveWorkroom: false, deliveredAt: null, deliverySurface: "other", traced: false, completedAt: null,
    ...overrides,
  };
}

describe("summarizePortfolioInvestment (BI-298A7202)", () => {
  it("sums points per portfolio by class, with explicit unallocated and unsized counts", () => {
    const summary = summarizePortfolioInvestment([
      row({ itemId: "a", epicPortfolioId: "p1", effortSize: "large" }),
      row({ itemId: "b", epicPortfolioId: "p1", status: "in-progress", effortSize: "small" }),
      row({ itemId: "c", productPortfolioId: "p1", status: "open", activeBuildId: "FB-1", effortSize: "small" }),
      row({ itemId: "d", storedPortfolioId: "p2", status: "done", completedAt: new Date("2026-08-01T00:00:00Z") }),
      row({ itemId: "e", effortSize: null }),
      row({ itemId: "f", effortSize: "xlarge" }),
    ], now);

    const p1 = summary.rows.find((r) => r.portfolioId === "p1")!;
    expect(p1).toMatchObject({ items: 3, readyPoints: 8, inFlightPoints: 2, deliveredPoints: 0, unsizedItems: 0 });
    expect(p1.paths).toEqual({ epic: 2, "digital-product": 1 });
    expect(summary.rows.find((r) => r.portfolioId === "p2")).toMatchObject({ items: 1, deliveredPoints: 3 });

    const unallocated = summary.rows.find((r) => r.portfolioId === null)!;
    expect(unallocated).toMatchObject({ items: 2, readyPoints: 20, unsizedItems: 1 });
    expect(summary.totals).toEqual({ liveItems: 5, deliveredThisQuarterItems: 1, unsizedItems: 1 });
  });

  it("reconciles: every row's items add up to live plus delivered-this-quarter", () => {
    const rows = [row({ itemId: "a" }), row({ itemId: "b", epicPortfolioId: "p1" }), row({ itemId: "c", effortSize: null })];
    const summary = summarizePortfolioInvestment(rows, now);
    const counted = summary.rows.reduce((sum, r) => sum + r.items, 0);
    expect(counted).toBe(summary.totals.liveItems + summary.totals.deliveredThisQuarterItems);
  });

  it("never adds an unsized item to a points total as zero", () => {
    const summary = summarizePortfolioInvestment([row({ effortSize: null, epicPortfolioId: "p1" })], now);
    expect(summary.rows[0]).toMatchObject({ readyPoints: 0, unsizedItems: 1, items: 1 });
  });

  it("drops a done item from outside the quarter and every retired item", () => {
    const summary = summarizePortfolioInvestment([
      row({ status: "done", completedAt: new Date("2026-03-01T00:00:00Z") }),
      row({ status: "retired" }),
    ], now);
    expect(summary.rows).toEqual([]);
  });

  it("treats a stored portfolioId naming no portfolio as unallocated, and counts it", () => {
    const summary = summarizePortfolioInvestment([
      row({ storedPortfolioId: "gone", storedPortfolioDangling: true, epicPortfolioId: "p1" }),
      row({ storedPortfolioId: "gone", storedPortfolioDangling: true }),
    ], now);
    expect(summary.rows.find((r) => r.portfolioId === "gone")).toBeUndefined();
    expect(summary.rows.find((r) => r.portfolioId === "p1")).toMatchObject({ items: 1, danglingStoredItems: 1 });
    expect(summary.rows.find((r) => r.portfolioId === null)).toMatchObject({ items: 1, danglingStoredItems: 1 });
  });

  it("counts an item with an active Workroom as in flight, whatever its status (design §5.6)", () => {
    const summary = summarizePortfolioInvestment([row({ epicPortfolioId: "p1", status: "open", hasActiveWorkroom: true })], now);
    expect(summary.rows[0]).toMatchObject({ inFlightPoints: 3, readyPoints: 0 });
  });
});

describe("the spend rule: a quarter is charged for what was delivered in it and what is actively in progress (BI-77313ADD)", () => {
  // Q4 2026: delivered means delivered between 1 Oct and 1 Jan.
  const q4 = new Date("2026-10-13T12:00:00Z");
  const inQ4 = new Date("2026-10-05T00:00:00Z");
  const inQ3 = new Date("2026-09-20T00:00:00Z");
  const classOf = (overrides: Partial<InvestmentItemRow>) =>
    resolveInvestmentItem(row({ epicPortfolioId: "p1", ...overrides }), quarterBounds(q4)).itemClass;

  it("charges a done item by its delivery date, not its acceptance date", () => {
    expect(classOf({ status: "done", deliveredAt: inQ4, completedAt: inQ4 })).toBe("delivered");
    // Merged in Q3, accepted in Q4: Q3 delivered it, so Q4 is not charged again.
    expect(classOf({ status: "done", deliveredAt: inQ3, completedAt: inQ4 })).toBeNull();
    // Never went through awaiting-acceptance: completedAt is its delivery date.
    expect(classOf({ status: "done", deliveredAt: null, completedAt: inQ4 })).toBe("delivered");
    expect(classOf({ status: "done", deliveredAt: null, completedAt: inQ3 })).toBeNull();
  });

  it("charges awaiting-acceptance work to the quarter it was delivered in, and an earlier quarter's to nothing now", () => {
    expect(classOf({ status: "awaiting-acceptance", deliveredAt: inQ4 })).toBe("delivered");
    expect(classOf({ status: "awaiting-acceptance", deliveredAt: inQ3 })).toBeNull();
    // Even with a room still open on it, delivered work is not in flight.
    expect(classOf({ status: "awaiting-acceptance", deliveredAt: inQ3, hasActiveWorkroom: true })).toBeNull();
  });

  it("counts in flight only work actively in progress: in-progress, an active build, or an active room", () => {
    expect(classOf({ status: "in-progress" })).toBe("inFlight");
    expect(classOf({ status: "open", activeBuildId: "FB-1" })).toBe("inFlight");
    expect(classOf({ status: "open", hasActiveWorkroom: true })).toBe("inFlight");
  });

  it("counts an open item whose room is parked with nothing running as ready", () => {
    expect(classOf({ status: "open", hasActiveWorkroom: false })).toBe("ready");
  });

  it("reads one active-work predicate the admission path shares", () => {
    expect(isActivelyInProgress(row({ status: "in-progress" }))).toBe(true);
    expect(isActivelyInProgress(row({ status: "open", activeBuildId: "FB-1" }))).toBe(true);
    expect(isActivelyInProgress(row({ status: "open", hasActiveWorkroom: true }))).toBe(true);
    expect(isActivelyInProgress(row({ status: "open" }))).toBe(false);
    expect(isActivelyInProgress(row({ status: "awaiting-acceptance", deliveredAt: inQ4 }))).toBe(false);
  });

  it("totals the live Foundational shape within its budget once prior deliveries and parked rooms are excluded", () => {
    const summary = summarizePortfolioInvestment([
      row({ itemId: "delivered-q4", status: "done", deliveredAt: inQ4, completedAt: inQ4, effortSize: "large" }),
      row({ itemId: "accepted-q4-merged-q3", status: "done", deliveredAt: inQ3, completedAt: inQ4, effortSize: "large" }),
      row({ itemId: "awaiting-q4", status: "awaiting-acceptance", deliveredAt: inQ4, effortSize: "medium" }),
      row({ itemId: "awaiting-q3", status: "awaiting-acceptance", deliveredAt: inQ3, effortSize: "large" }),
      row({ itemId: "parked", status: "open", hasActiveWorkroom: false, effortSize: "large" }),
      row({ itemId: "running", status: "in-progress", effortSize: "small" }),
    ].map((r) => ({ ...r, epicPortfolioId: "p1" })), q4);
    expect(summary.rows[0]).toMatchObject({ deliveredPoints: 11, inFlightPoints: 1, readyPoints: 8, items: 4 });
  });
});

describe("platform work with no portfolio counts as Foundational (BI-291F7451)", () => {
  it("attributes platform/common items to Foundational by rule, counts them as such, and leaves archetype work unallocated", () => {
    const delivered = { status: "done", completedAt: new Date("2026-08-01T00:00:00Z"), platformDefaultPortfolioId: "pf" };
    const summary = summarizePortfolioInvestment([
      row({ ...delivered, itemId: "plat", scopeKind: "platform", effortSize: "large" }),
      row({ ...delivered, itemId: "com", scopeKind: "common", effortSize: "small" }),
      row({ ...delivered, itemId: "explicit", scopeKind: "platform", storedPortfolioId: "pf", effortSize: "medium" }),
      row({ ...delivered, itemId: "arch", scopeKind: "archetype-leaf", effortSize: "medium" }),
      row({ itemId: "live", scopeKind: "platform", status: "in-progress", effortSize: "small", platformDefaultPortfolioId: "pf" }),
    ], now);

    const foundational = summary.rows.find((r) => r.portfolioId === "pf")!;
    expect(foundational).toMatchObject({ items: 4, deliveredPoints: 12, inFlightPoints: 1 });
    expect(foundational.paths).toEqual({ "platform-default": 3, stored: 1 });
    expect(foundational.attributedByRule).toEqual({ items: 3, readyPoints: 0, inFlightPoints: 1, deliveredPoints: 9 });
    expect(summary.rows.find((r) => r.portfolioId === null)).toMatchObject({ items: 1, deliveredPoints: 3 });
  });
});
