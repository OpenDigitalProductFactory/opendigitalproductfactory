import { describe, expect, it } from "vitest";

import type { InvestmentItemRow } from "./investment-read-model";
import { assembleTieOut } from "./tie-out";

const now = new Date("2026-09-10T12:00:00Z"); // 3 weeks before the quarter ends
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

function item(overrides: Partial<InvestmentItemRow>): InvestmentItemRow {
  return {
    itemId: "BI-1", status: "open", effortSize: "medium", jobSize: null, estimateAgreed: null,
    storedPortfolioId: "p1", storedPortfolioDangling: false, productPortfolioId: null, taxonomyPortfolioId: null,
    coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null, hasLiveWorkroom: false,
    deliverySurface: "other", traced: false, completedAt: null,
    ...overrides,
  };
}

const delivered = (itemId: string, points: string, days: number, traced: boolean) =>
  item({ itemId, status: "done", effortSize: points, completedAt: daysAgo(days), traced });

describe("assembleTieOut (BI-CBF5D708, design §6)", () => {
  const base = {
    now,
    portfolios: [{ id: "p1", name: "Foundational" }, { id: "p2", name: "Workforce" }],
    historyStart: daysAgo(300),
    budgets: new Map([["p1", { id: "b", allocatedPoints: 40, usdPerPoint: null, wipAllowancePoints: null, setById: "u", setByAgentId: null, reason: "r", supersedesId: null, createdAt: now }]]),
    openReservations: [{ itemId: "BI-RES", portfolioId: "p1", points: 8 }],
    untracedChanges: 7,
  };
  // p1 delivered 8 (traced) + 3 (untraced) this window; one medium in flight; one large reserved but not started.
  const quarterItems = [
    delivered("BI-D1", "large", 3, true),
    delivered("BI-D2", "medium", 10, false),
    item({ itemId: "BI-FLIGHT", status: "in-progress", effortSize: "medium" }),
    item({ itemId: "BI-RES", status: "open", effortSize: "large" }),
  ];

  it("shows every portfolio and the unallocated row, and 'no budget set' as null, never zero (AC-2)", () => {
    const t = assembleTieOut({ ...base, quarterItems, windowItems: quarterItems });
    expect(t.rows.map((r) => r.portfolioId)).toEqual(["p1", "p2", null]);
    expect(t.rows[0]!.budget?.allocatedPoints).toBe(40);
    expect(t.rows[1]!.budget).toBeNull();
    expect(t.rows[2]!.name).toBe("Unallocated");
    expect(t.untracedChanges).toBe(7);
  });

  it("counts reserved, in flight, delivered and committed points, each item once", () => {
    const p1 = assembleTieOut({ ...base, quarterItems, windowItems: quarterItems }).rows[0]!;
    expect(p1).toMatchObject({ reservedPoints: 8, inFlightPoints: 3, deliveredPoints: 11, committedPoints: 11 });
  });

  it("states the traced share of delivered points on every row (AC-2)", () => {
    const t = assembleTieOut({ ...base, quarterItems, windowItems: quarterItems });
    expect(t.rows[0]!.tracedShare).toBeCloseTo(8 / 11, 3);
    expect(t.rows[1]!.tracedShare).toBeNull();
  });

  it("gives over-commitment in points (a range) and in weeks, never as a colour alone (AC-3)", () => {
    const p1 = assembleTieOut({ ...base, quarterItems, windowItems: quarterItems }).rows[0]!;
    expect(p1.forecast.label).toBe("measured");
    expect(typeof p1.overCommitment.pointsLow).toBe("number");
    expect(typeof p1.overCommitment.pointsHigh).toBe("number");
    expect(p1.overCommitment.pointsLow).toBeLessThanOrEqual(p1.overCommitment.pointsHigh);
    expect(p1.overCommitment.weeks === null || typeof p1.overCommitment.weeks === "number").toBe(true);
  });

  it("labels the forecast estimated on an install with under four weeks of history (AC-1)", () => {
    const t = assembleTieOut({ ...base, historyStart: daysAgo(10), quarterItems, windowItems: quarterItems });
    expect(t.rows[0]!.forecast.label).toBe("estimated");
  });
});
