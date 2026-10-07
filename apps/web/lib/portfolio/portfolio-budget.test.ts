import { describe, expect, it } from "vitest";

import { quarterBounds } from "./investment-points";
import {
  portfolioBudgetLabel,
  previousQuarter,
  proposalReason,
  proposePortfolioBudgets,
  resolveProposalBasis,
  setPortfolioBudget,
  type PortfolioBudget,
} from "./portfolio-budget";

const q3 = quarterBounds(new Date("2026-09-25T00:00:00Z"));
const actor = { userId: "user-1", agentId: "external-claude-code" };

function writeDb(current: { id: string } | null, createError?: unknown) {
  const creates: Array<Record<string, unknown>> = [];
  return {
    creates,
    $queryRaw: async () => (current ? [current] : []),
    portfolio: { findUnique: async (args: any) => (args.where.id === "p1" ? { id: "p1" } : null) },
    agent: { findUnique: async (args: any) => (args.where.agentId === "external-claude-code" ? { agentId: "external-claude-code" } : null) },
    portfolioBudgetPeriod: {
      create: async (args: any) => {
        if (createError) throw createError;
        creates.push(args.data);
        return { id: "new-row" };
      },
    },
  };
}

describe("setPortfolioBudget (BI-9EC60FE0)", () => {
  it("records who set the budget, why, and the row it supersedes (AC-1)", async () => {
    const db = writeDb({ id: "old-row" });
    const result = await setPortfolioBudget(db as any, { portfolioId: "p1", period: q3, allocatedPoints: 120, usdPerPoint: 250, reason: "Q3 from proposal", actor });
    expect(result).toEqual({ ok: true, data: { budgetId: "new-row", supersedesId: "old-row" } });
    expect(db.creates[0]).toMatchObject({
      portfolioId: "p1", periodStart: q3.start, periodEnd: q3.end, allocatedPoints: 120, usdPerPoint: 250,
      setById: "user-1", setByAgentId: "external-claude-code", reason: "Q3 from proposal", supersedesId: "old-row",
    });
  });

  it("starts a new chain when the period has no budget yet", async () => {
    const db = writeDb(null);
    expect(await setPortfolioBudget(db as any, { portfolioId: "p1", period: q3, allocatedPoints: 0, reason: "hold", actor }))
      .toEqual({ ok: true, data: { budgetId: "new-row", supersedesId: null } });
  });

  it.each([
    [{ reason: " " }, "reason_required"],
    [{ actor: { userId: null } }, "actor_required"],
    [{ allocatedPoints: -1 }, "invalid_points"],
    [{ allocatedPoints: 1.5 }, "invalid_points"],
    [{ usdPerPoint: 0 }, "invalid_rate"],
    [{ wipAllowancePoints: -3 }, "invalid_allowance"],
    [{ portfolioId: "nope" }, "unknown_portfolio"],
    [{ period: { start: new Date("2026-08-01T00:00:00Z"), end: q3.end } }, "period_not_a_quarter"],
  ])("refuses %o with %s and writes nothing", async (override, code) => {
    const db = writeDb(null);
    const result = await setPortfolioBudget(db as any, { portfolioId: "p1", period: q3, allocatedPoints: 10, reason: "r", actor, ...override });
    expect(result).toMatchObject({ ok: false, error: code });
    expect(db.creates).toEqual([]);
  });

  it("reports a racing write as a concurrent change rather than forking the chain", async () => {
    const db = writeDb({ id: "old-row" }, Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await setPortfolioBudget(db as any, { portfolioId: "p1", period: q3, allocatedPoints: 5, reason: "r", actor }))
      .toMatchObject({ ok: false, error: "concurrent_change" });
  });
});

describe("portfolioBudgetLabel (AC-3)", () => {
  const budget: PortfolioBudget = { id: "b", allocatedPoints: 1200, usdPerPoint: null, wipAllowancePoints: null, setById: "u", setByAgentId: null, reason: "r", supersedesId: null, createdAt: new Date() };
  it("says 'No budget set' instead of zero", () => {
    expect(portfolioBudgetLabel(null)).toBe("No budget set");
    expect(portfolioBudgetLabel({ ...budget, allocatedPoints: 0 })).toBe("0 points");
  });
  it("shows the derived dollars beside the points when a rate is set", () => {
    expect(portfolioBudgetLabel(budget)).toBe("1,200 points");
    expect(portfolioBudgetLabel({ ...budget, usdPerPoint: 250 })).toBe("1,200 points ($300,000 at $250/point)");
  });
});

describe("proposePortfolioBudgets (AC-2)", () => {
  it("proposes the previous quarter's delivered points per portfolio and states the unplaced share", async () => {
    const done = (itemId: string, stored: string | null, effortSize: string) => ({
      itemId, status: "done", effortSize, jobSize: null, estimateAgreed: null, storedPortfolioId: stored, storedPortfolioDangling: false,
      productPortfolioId: null, taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null, hasLiveWorkroom: false, deliverySurface: "other", traced: false,
      completedAt: new Date("2026-08-10T00:00:00Z"),
    });
    const db = {
      $queryRaw: async (parts: TemplateStringsArray) => !parts.join("").includes('"BacklogItem"')
        ? [{ id: "p1", slug: "a", name: "A" }, { id: "p2", slug: "b", name: "B" }]
        : [done("i1", "p1", "large"), done("i2", "p1", "small"), done("i3", null, "medium")],
    };
    const q4 = quarterBounds(new Date("2026-10-15T00:00:00Z"));
    const proposal = await proposePortfolioBudgets(db as any, q4);
    expect(proposal.basisPeriod).toEqual(previousQuarter(q4));
    expect(proposal.rows).toEqual([
      { id: "p1", slug: "a", name: "A", deliveredPoints: 9, proposedPoints: 9, share: 1 },
      { id: "p2", slug: "b", name: "B", deliveredPoints: 0, proposedPoints: 0, share: 0 },
    ]);
    expect(proposal).toMatchObject({ unallocatedDeliveredPoints: 3, totalDeliveredPoints: 12 });
  });
});

describe("proposal from a trailing window of delivered points (operator decision: first quarter from the last 90 days)", () => {
  const q4 = quarterBounds(new Date("2026-10-15T00:00:00Z"));
  const asOf = new Date("2026-10-06T00:00:00Z");

  it("resolves the window as the N days before asOf, scaled to the target quarter's length", () => {
    expect(resolveProposalBasis(q4, { trailingDays: 90, asOf })).toEqual({
      ok: true,
      data: {
        kind: "trailing-days",
        period: { start: new Date("2026-07-08T00:00:00Z"), end: asOf },
        days: 90,
        // Q4 2026 is 92 days long.
        scale: 92 / 90,
      },
    });
  });

  it("defaults to the previous quarter at scale 1 (AC-2 unchanged)", () => {
    expect(resolveProposalBasis(q4, {})).toEqual({ ok: true, data: { kind: "previous-quarter", period: previousQuarter(q4), days: null, scale: 1 } });
  });

  it.each([0, -5, 2.5, 367, Number.NaN])("refuses a window of %s days", (trailingDays) => {
    expect(resolveProposalBasis(q4, { trailingDays, asOf })).toMatchObject({ ok: false, error: "invalid_basis" });
  });

  it("counts only items done inside the window and scales them to the quarter", async () => {
    const done = (itemId: string, stored: string | null, effortSize: string, completedAt: string) => ({
      itemId, status: "done", effortSize, jobSize: null, estimateAgreed: null, storedPortfolioId: stored, storedPortfolioDangling: false,
      productPortfolioId: null, taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null, hasLiveWorkroom: false, deliverySurface: "other", traced: false,
      completedAt: new Date(completedAt),
    });
    const db = {
      $queryRaw: async (parts: TemplateStringsArray) => !parts.join("").includes('"BacklogItem"')
        ? [{ id: "p1", slug: "a", name: "A" }, { id: "p2", slug: "b", name: "B" }]
        : [
          done("in-1", "p1", "xlarge", "2026-07-08T00:00:00Z"), // first instant of the window
          done("in-2", "p1", "xlarge", "2026-10-05T23:00:00Z"),
          done("in-3", "p2", "large", "2026-09-01T00:00:00Z"),
          done("in-4", null, "medium", "2026-08-01T00:00:00Z"),
          done("before", "p1", "xlarge", "2026-07-07T23:59:59Z"),
          done("after", "p2", "xlarge", "2026-10-06T00:00:00Z"),
        ],
    };
    const proposal = await proposePortfolioBudgets(db as any, q4, { trailingDays: 90, asOf });
    expect(proposal.basis).toEqual({ kind: "trailing-days", days: 90, scale: 92 / 90 });
    expect(proposal.basisPeriod).toEqual({ start: new Date("2026-07-08T00:00:00Z"), end: asOf });
    expect(proposal.rows).toEqual([
      { id: "p1", slug: "a", name: "A", deliveredPoints: 40, proposedPoints: 41, share: 0.833 },
      { id: "p2", slug: "b", name: "B", deliveredPoints: 8, proposedPoints: 8, share: 0.167 },
    ]);
    expect(proposal).toMatchObject({ unallocatedDeliveredPoints: 3, totalDeliveredPoints: 51 });
  });
});

describe("proposalReason", () => {
  const q4 = quarterBounds(new Date("2026-10-15T00:00:00Z"));
  it("names a trailing-window proposal as provisional and revisable, with its window and scale", () => {
    expect(proposalReason({
      targetPeriod: q4,
      basisPeriod: { start: new Date("2026-07-08T00:00:00Z"), end: new Date("2026-10-06T00:00:00Z") },
      basis: { kind: "trailing-days", days: 90, scale: 92 / 90 },
    })).toBe("Provisional, revisable: proposed from points delivered in the 90 days 2026-07-08 to 2026-10-06, scaled x1.022 to the 92-day quarter starting 2026-10-01.");
  });
  it("names a previous-quarter proposal by its quarter", () => {
    expect(proposalReason({ targetPeriod: q4, basisPeriod: previousQuarter(q4), basis: { kind: "previous-quarter", days: null, scale: 1 } }))
      .toBe("Proposed from points delivered in the quarter starting 2026-07-01, for the quarter starting 2026-10-01.");
  });
});
