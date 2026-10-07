import { describe, expect, it } from "vitest";

import { LARGE_ITEM_FLOOR_POINTS, blocksStart, decideInvestmentAdmission, wipAllowance } from "./investment-admission";

const base = { inFlightPoints: 0, itemPoints: 3, allowance: 10, startKind: "autonomous" as const, breakFix: false, alreadyInFlight: false };

describe("decideInvestmentAdmission (BI-3430B3A4)", () => {
  it("admits ten small items and two large items alike when their points are equal (AC-1)", () => {
    const tenSmall = decideInvestmentAdmission({ ...base, allowance: 20, inFlightPoints: 9, itemPoints: 1 });
    const twoLarge = decideInvestmentAdmission({ ...base, allowance: 20, inFlightPoints: 8, itemPoints: 8 });
    expect(tenSmall.verdict).toBe("admit");
    expect(twoLarge.verdict).toBe("admit");
    // ...and both are refused alike once the points no longer fit.
    expect(decideInvestmentAdmission({ ...base, allowance: 10, inFlightPoints: 10, itemPoints: 1 }).verdict).toBe("refuse");
    expect(decideInvestmentAdmission({ ...base, allowance: 10, inFlightPoints: 8, itemPoints: 8 }).verdict).toBe("refuse");
  });

  it("refuses an autonomous start past the allowance and says why (AC-2)", () => {
    const d = decideInvestmentAdmission({ ...base, inFlightPoints: 9, itemPoints: 3 });
    expect(d).toMatchObject({ verdict: "refuse" });
    expect(d.reason).toContain("12 of 10 points");
  });

  it("lets a person start past the allowance with a warning (AC-3)", () => {
    expect(decideInvestmentAdmission({ ...base, startKind: "human", inFlightPoints: 9, itemPoints: 3 })).toMatchObject({ verdict: "warn" });
  });

  it("counts break-fix work but never blocks it", () => {
    expect(decideInvestmentAdmission({ ...base, breakFix: true, inFlightPoints: 50 })).toMatchObject({ verdict: "admit" });
  });

  it("admits an item already in flight: it is not a new start", () => {
    expect(decideInvestmentAdmission({ ...base, alreadyInFlight: true, inFlightPoints: 50 })).toMatchObject({ verdict: "admit" });
  });

  it("does not let an unsized item slip past the limit", () => {
    expect(decideInvestmentAdmission({ ...base, itemPoints: null }).verdict).toBe("refuse");
    expect(decideInvestmentAdmission({ ...base, startKind: "human", itemPoints: null }).verdict).toBe("warn");
  });
});

describe("wipAllowance", () => {
  it("uses the period's override first, then throughput x two weeks, then the one-large-item floor", () => {
    expect(wipAllowance({ override: 30, weeklyThroughput: 40 })).toEqual({ points: 30, source: "override" });
    expect(wipAllowance({ override: null, weeklyThroughput: 12 })).toEqual({ points: 24, source: "throughput" });
    expect(wipAllowance({ override: null, weeklyThroughput: 2 })).toEqual({ points: LARGE_ITEM_FLOOR_POINTS, source: "floor" });
    expect(wipAllowance({ override: null, weeklyThroughput: null })).toEqual({ points: 8, source: "floor" });
  });
});

describe("blocksStart (shadow first, WWMD DI-D83D9C13686B)", () => {
  it("only an enforced refusal stops a start", () => {
    expect(blocksStart({ verdict: "refuse", mode: "enforce" })).toBe(true);
    expect(blocksStart({ verdict: "refuse", mode: "shadow" })).toBe(false);
    expect(blocksStart({ verdict: "warn", mode: "enforce" })).toBe(false);
    expect(blocksStart({ verdict: "admit", mode: "enforce" })).toBe(false);
  });
});

describe("admission and the budget proposal attribute an item alike (BI-291F7451 AC-1)", () => {
  const now = new Date("2026-10-06T00:00:00Z");
  const base = {
    status: "open", effortSize: "small", jobSize: null, estimateAgreed: null, storedPortfolioId: null, storedPortfolioDangling: false,
    productPortfolioId: null, taxonomyPortfolioId: null, coworkerNeedPortfolioId: null, epicPortfolioId: null, activeBuildId: null,
    hasLiveWorkroom: false, deliverySurface: "other", traced: false, completedAt: null, platformDefaultPortfolioId: "pf",
  };
  const items = [
    { ...base, itemId: "BI-NEW", scopeKind: "platform" },
    { ...base, itemId: "BI-FLIGHT", scopeKind: "common", status: "in-progress", effortSize: "large" },
    { ...base, itemId: "BI-ARCH", scopeKind: "archetype-leaf" },
    { ...base, itemId: "BI-DONE", scopeKind: "platform", status: "done", effortSize: "medium", completedAt: new Date("2026-09-01T00:00:00Z") },
  ];
  const db = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join("");
      if (sql.includes('FROM "BacklogItem" b')) return items;
      if (sql.includes('"PortfolioBudgetPeriod"')) return [];
      if (sql.includes('"PlatformDevConfig"')) return [{ mode: "shadow" }];
      if (sql.includes('SELECT "id" FROM "BacklogItem"')) return [{ id: "row-1" }];
      return [{ id: "pf", slug: "foundational", name: "Foundational" }];
    },
  };

  it("draws platform work on Foundational's allowance, the portfolio the proposal credits it to", async () => {
    const { evaluateItemAdmission } = await import("./investment-admission");
    const { proposePortfolioBudgets } = await import("@/lib/portfolio/portfolio-budget");
    const admission = await evaluateItemAdmission(db as never, { itemId: "BI-NEW", startKind: "autonomous", now, weeklyThroughput: null });
    expect(admission).toMatchObject({ portfolioId: "pf", inFlightPoints: 8, itemPoints: 1 });

    const proposal = await proposePortfolioBudgets(db as never, { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2027-01-01T00:00:00Z") }, { trailingDays: 90, asOf: now });
    expect(proposal.rows.find((r) => r.id === admission.portfolioId)).toMatchObject({ deliveredPoints: 3, attributedByRule: { deliveredPoints: 3 } });
  });

  it("keeps archetype work with no portfolio on the unallocated allowance", async () => {
    const { evaluateItemAdmission } = await import("./investment-admission");
    expect(await evaluateItemAdmission(db as never, { itemId: "BI-ARCH", startKind: "autonomous", now, weeklyThroughput: null }))
      .toMatchObject({ portfolioId: null, inFlightPoints: 0 });
  });
});
