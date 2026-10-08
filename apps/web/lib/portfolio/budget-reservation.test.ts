import { describe, expect, it } from "vitest";

import { isAutonomousCaller, planFundingReservation, settlementFor } from "./budget-reservation";

const now = new Date("2026-09-25T12:00:00Z");

// The attribution links the shared investment loader selects: by default the
// item names portfolio p1 directly.
const explicitLinks = {
  storedPortfolioId: "p1", storedPortfolioDangling: false, productPortfolioId: null, taxonomyPortfolioId: null,
  coworkerNeedPortfolioId: null, epicPortfolioId: null, scopeKind: "platform", platformDefaultPortfolioId: "p-foundational",
};

// Answers the plan's raw queries: the item row, its attribution links, the budget rows, and the committed sum.
function planDb(options: { item?: Record<string, unknown> | null; links?: Record<string, unknown>; open?: boolean; allocated?: number | null; committed?: number; portfolioExists?: boolean }) {
  const item = options.item === null ? null : { id: "row-1", effortSize: "large", jobSize: null, estimateAgreed: null, open: options.open ?? false, ...options.item };
  const links = { itemId: "BI-1", status: "open", effortSize: "large", jobSize: null, estimateAgreed: null, ...explicitLinks, ...options.links };
  return {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join("?");
      if (sql.includes('FROM "BacklogItem" b WHERE b."itemId"')) return item ? [item] : [];
      if (sql.includes('AS "storedPortfolioId"')) return item ? [links] : [];
      if (sql.includes('FROM "PortfolioBudgetPeriod" b')) {
        return options.allocated == null ? [] : [{ id: "bud", portfolioId: "p1", allocatedPoints: options.allocated, usdPerPoint: null, wipAllowancePoints: null, setById: "u", setByAgentId: null, reason: "r", supersedesId: null, createdAt: now }];
      }
      if (sql.includes('FROM "Portfolio"')) return [{ id: "p1", slug: "a", name: "A" }];
      if (sql.includes("SUM(r.\"points\")")) return [{ points: options.committed ?? 0 }];
      return [];
    },
    portfolio: { findUnique: async (args: { where: { id: string } }) => (options.portfolioExists === false ? null : { id: args.where.id }) },
  };
}

describe("isAutonomousCaller", () => {
  it("treats a background task, or an agent with no person's session, as autonomous", () => {
    expect(isAutonomousCaller({ taskRunId: "TR-1", threadId: "t" })).toBe(true);
    expect(isAutonomousCaller({ agentId: "AGT-1" })).toBe(true);
  });
  it("treats a person in a portal thread or an external client session as a person", () => {
    expect(isAutonomousCaller(undefined)).toBe(false);
    expect(isAutonomousCaller({ agentId: "AGT-1", threadId: "t" })).toBe(false);
    expect(isAutonomousCaller({ agentId: "external-claude-code", apiTokenId: "tok" })).toBe(false);
  });
});

describe("planFundingReservation (BI-EF265C9A)", () => {
  it("reserves the item's points within the allocation", async () => {
    expect(await planFundingReservation(planDb({ allocated: 20, committed: 10 }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "reserve", points: 8, portfolioId: "p1", overrideReason: null, warning: null });
  });

  it("refuses an autonomous approval past the allocation, with the arithmetic (AC-2)", async () => {
    const plan = await planFundingReservation(planDb({ allocated: 10, committed: 5 }) as any, { itemId: "BI-1", now, autonomous: true });
    expect(plan).toMatchObject({ kind: "refuse", code: "over_budget_autonomous" });
    expect((plan as { message: string }).message).toContain("13 of 10 points");
  });

  it("asks a person for a reason past the allocation, and records it when given (AC-2)", async () => {
    expect(await planFundingReservation(planDb({ allocated: 10, committed: 5 }) as any, { itemId: "BI-1", now, autonomous: false }))
      .toMatchObject({ kind: "refuse", code: "over_budget_reason_required" });
    expect(await planFundingReservation(planDb({ allocated: 10, committed: 5 }) as any, { itemId: "BI-1", now, autonomous: false, overrideReason: "launch-critical" }))
      .toMatchObject({ kind: "reserve", overrideReason: "launch-critical", warning: expect.stringContaining("3 over") });
  });

  it("reserves with a warning when the portfolio has no budget this quarter", async () => {
    expect(await planFundingReservation(planDb({ allocated: null }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "reserve", warning: expect.stringContaining("No budget is set") });
  });

  it("reserves nothing for an unsized, unallocated or already-reserved item", async () => {
    expect(await planFundingReservation(planDb({ item: { effortSize: null } }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "none", reason: "unsized" });
    expect(await planFundingReservation(planDb({ portfolioExists: false }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "none", reason: "unallocated" });
    expect(await planFundingReservation(planDb({ open: true }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "none", reason: "already-reserved" });
  });
});

describe("planFundingReservation attributes like the budget proposal (BI-A0C66062)", () => {
  const noExplicit = { storedPortfolioId: null };

  it.each(["platform", "common", "unknown", null])("reserves %s-scoped work with no explicit portfolio against Foundational (AC-1)", async (scopeKind) => {
    expect(await planFundingReservation(planDb({ allocated: null, links: { ...noExplicit, scopeKind } }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "reserve", portfolioId: "p-foundational", points: 8 });
  });

  it("reserves nothing for archetype-scoped work with no explicit portfolio (AC-2)", async () => {
    expect(await planFundingReservation(planDb({ allocated: null, links: { ...noExplicit, scopeKind: "archetype-leaf" } }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "none", reason: "unallocated" });
  });

  it("keeps an explicit portfolio ahead of the Foundational rule", async () => {
    expect(await planFundingReservation(planDb({ allocated: null, links: { storedPortfolioId: null, epicPortfolioId: "p-epic" } }) as any, { itemId: "BI-1", now, autonomous: true }))
      .toMatchObject({ kind: "reserve", portfolioId: "p-epic" });
  });
});

describe("settlementFor (AC-1)", () => {
  const base = { reservationId: "r", points: 8, effortSize: "large", jobSize: null, estimateAgreed: null };
  it("consumes on done and releases on retired or deferred", () => {
    expect(settlementFor({ ...base, status: "done" }).kind).toBe("consume");
    expect(settlementFor({ ...base, status: "retired" }).kind).toBe("release");
    expect(settlementFor({ ...base, status: "deferred" }).kind).toBe("release");
  });
  it("adjusts a re-sized item and leaves an unchanged one alone", () => {
    expect(settlementFor({ ...base, status: "in-progress", effortSize: "xlarge" })).toEqual({ kind: "resize", reservationId: "r", from: 8, to: 20 });
    expect(settlementFor({ ...base, status: "open" }).kind).toBe("keep");
  });
  it("keeps the reserved points when the item loses its size, rather than zeroing them", () => {
    expect(settlementFor({ ...base, status: "open", effortSize: null }).kind).toBe("keep");
  });
});
