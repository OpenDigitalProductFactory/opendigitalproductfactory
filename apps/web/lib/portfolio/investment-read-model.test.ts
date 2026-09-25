import { describe, expect, it } from "vitest";

import { summarizePortfolioInvestment, type InvestmentItemRow } from "./investment-read-model";

const now = new Date("2026-09-25T12:00:00Z");

function row(overrides: Partial<InvestmentItemRow>): InvestmentItemRow {
  return {
    itemId: "BI-1", status: "open", effortSize: "medium", jobSize: null, estimateAgreed: null,
    storedPortfolioId: null, storedPortfolioDangling: false, productPortfolioId: null, taxonomyPortfolioId: null,
    coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null, completedAt: null,
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
});
