import { describe, expect, it } from "vitest";

import type { InvestmentItemRow } from "@/lib/portfolio/investment-read-model";
import type { PortfolioBudgetStatus } from "@/lib/portfolio/portfolio-budget";

import {
  AUTHOR_STAGE_AGENT_REF,
  buildAuthorStageFunding,
  decideAuthorStageAutonomy,
  type AuthorStageFunding,
} from "./author-stage-autonomy";
import type { AuthorStagePreauthorisation } from "./author-stage-preauthorisation";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const IN_FORCE: AuthorStagePreauthorisation = { state: "in-force", setByUserId: "user-op", setAt: NOW.toISOString(), reason: "all shapes" };
const FUNDED: AuthorStageFunding = { funded: true, portfolioId: "pf-found", summary: "funded" };

function item(overrides: Partial<InvestmentItemRow> = {}): InvestmentItemRow {
  return {
    itemId: "BI-1",
    status: "in-progress",
    effortSize: "medium",
    jobSize: null,
    estimateAgreed: null,
    activeBuildId: null,
    hasActiveWorkroom: true, deliveredAt: null,
    deliverySurface: "external",
    traced: true,
    completedAt: null,
    storedPortfolioId: "pf-found",
    storedPortfolioDangling: false,
    productPortfolioId: null,
    taxonomyPortfolioId: null,
    coworkerNeedPortfolioId: null,
    epicPortfolioId: null,
    scopeKind: "platform",
    platformDefaultPortfolioId: "pf-found",
    ...overrides,
  };
}

function budget(allocatedPoints: number | null, usdPerPoint: number | null = null): PortfolioBudgetStatus {
  return {
    id: "pf-found",
    slug: "foundational",
    name: "Foundational",
    budget: allocatedPoints === null ? null : {
      id: "budget-1", allocatedPoints, usdPerPoint, wipAllowancePoints: null,
      setById: "user-op", setByAgentId: null, reason: "derived", supersedesId: null, createdAt: NOW,
    },
  };
}

describe("buildAuthorStageFunding (BI-8A32EBFF / BI-A59837E5: quarterly plan is advisory guidance)", () => {
  it("is funded with no advisory warning when committed points are below or at the quarterly plan", () => {
    const below = buildAuthorStageFunding({ items: [item()], budgets: [budget(20)], now: NOW })("BI-1");
    expect(below).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (below.funded) expect(below.advisory ?? null).toBeNull();

    const atPlan = buildAuthorStageFunding({ items: [item({ effortSize: "large" })], budgets: [budget(8)], now: NOW })("BI-1");
    expect(atPlan).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (atPlan.funded) expect(atPlan.advisory ?? null).toBeNull();
  });

  it("treats no budget set as an advisory planning warning with unknown spend forecast, never zero or a stop", () => {
    const funding = buildAuthorStageFunding({ items: [item()], budgets: [budget(null)], now: NOW })("BI-1");
    expect(funding).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (funding.funded) {
      expect(funding.advisory).toMatch(/No quarterly plan is set for Foundational/);
      expect(funding.advisory).toMatch(/unknown/i);
    }
  });

  it("keeps an over-quarter portfolio funded with an advisory warning showing planned, committed, overage, drivers, and spend basis", () => {
    const items = [
      item({ itemId: "BI-1", status: "in-progress", effortSize: "medium" }),
      item({ itemId: "BI-2", status: "done", hasActiveWorkroom: false, deliveredAt: NOW, completedAt: NOW, effortSize: "large" }),
    ];
    const withoutRate = buildAuthorStageFunding({ items, budgets: [budget(8)], now: NOW })("BI-1");
    expect(withoutRate).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (withoutRate.funded) {
      expect(withoutRate.advisory).toMatch(/11 of 8 points/);
      expect(withoutRate.advisory).toMatch(/3 over/);
      expect(withoutRate.advisory).toMatch(/8 delivered, 3 in flight/);
      expect(withoutRate.advisory).toMatch(/unknown/i);
    }

    const withRate = buildAuthorStageFunding({ items, budgets: [budget(8, 500)], now: NOW })("BI-1");
    expect(withRate).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (withRate.funded) {
      expect(withRate.advisory).toMatch(/\$500\/pt/);
      expect(withRate.advisory).toMatch(/\$5,500/);
    }
  });

  it("treats unattributed or unsized live work as advisory warnings while still refusing unbound or non-live work", () => {
    const build = buildAuthorStageFunding({
      items: [item({ itemId: "BI-U", storedPortfolioId: null, scopeKind: "archetype-leaf" }), item({ itemId: "BI-S", effortSize: null })],
      budgets: [budget(50)],
      now: NOW,
    });
    const unattributed = build("BI-U");
    expect(unattributed).toMatchObject({ funded: true, portfolioId: null });
    if (unattributed.funded) expect(unattributed.advisory).toMatch(/reaches no portfolio/i);

    const unsized = build("BI-S");
    expect(unsized).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (unsized.funded) expect(unsized.advisory).toMatch(/no size/i);

    expect(build("BI-NONE")).toMatchObject({ funded: false, because: expect.stringMatching(/not live work/) });
    expect(build(null)).toMatchObject({ funded: false, because: expect.stringMatching(/bound to no backlog item/) });
  });
});

describe("buildAuthorStageFunding charges only this quarter's deliveries and active work (BI-77313ADD / BI-A59837E5)", () => {
  const lastQuarter = new Date("2026-09-20T00:00:00.000Z");
  const thisQuarter = new Date("2026-10-03T00:00:00.000Z");

  it("excludes prior-quarter deliveries and parked rooms from committed points (below plan, no advisory warning)", () => {
    const items = [
      item({ itemId: "BI-ROOM", status: "open", hasActiveWorkroom: false, effortSize: "medium" }),
      item({ itemId: "BI-AWAIT-Q3", status: "awaiting-acceptance", hasActiveWorkroom: false, deliveredAt: lastQuarter, effortSize: "large" }),
      item({ itemId: "BI-ACCEPTED-Q4-MERGED-Q3", status: "done", hasActiveWorkroom: false, deliveredAt: lastQuarter, completedAt: thisQuarter, effortSize: "large" }),
      item({ itemId: "BI-PARKED-1", status: "open", hasActiveWorkroom: false, effortSize: "large" }),
      item({ itemId: "BI-PARKED-2", status: "open", hasActiveWorkroom: false, effortSize: "large" }),
      item({ itemId: "BI-DONE-Q4", status: "done", hasActiveWorkroom: false, deliveredAt: thisQuarter, completedAt: thisQuarter, effortSize: "medium" }),
      item({ itemId: "BI-RUNNING", status: "in-progress", effortSize: "small" }),
    ];
    const funding = buildAuthorStageFunding({ items, budgets: [budget(8)], now: NOW })("BI-ROOM");
    expect(funding).toMatchObject({ funded: true, summary: expect.stringMatching(/Foundational: 4 of 8 points committed this quarter/) });
    if (funding.funded) expect(funding.advisory ?? null).toBeNull();
  });

  it("warns without stopping when this quarter's deliveries and active work exceed the quarterly plan", () => {
    const items = [
      item({ itemId: "BI-ROOM", status: "open", hasActiveWorkroom: false }),
      item({ itemId: "BI-AWAIT-Q4", status: "awaiting-acceptance", hasActiveWorkroom: false, deliveredAt: thisQuarter, effortSize: "large" }),
      item({ itemId: "BI-RUNNING", status: "open", hasActiveWorkroom: true, effortSize: "medium" }),
    ];
    const funding = buildAuthorStageFunding({ items, budgets: [budget(8)], now: NOW })("BI-ROOM");
    expect(funding).toMatchObject({ funded: true, portfolioId: "pf-found" });
    if (funding.funded) {
      expect(funding.advisory).toMatch(/11 of 8 points/);
      expect(funding.advisory).toMatch(/8 delivered, 3 in flight/);
    }
  });
});

describe("decideAuthorStageAutonomy (BI-8A32EBFF AC-1, AC-2)", () => {
  it("binds role:author to the software-engineer coworker when funded and in force", () => {
    expect(decideAuthorStageAutonomy({ shapeKey: "delivery-medium", preauthorisation: IN_FORCE, funding: FUNDED }))
      .toEqual({ roleBindings: { author: AUTHOR_STAGE_AGENT_REF }, withheldBecause: null });
    expect(AUTHOR_STAGE_AGENT_REF).toBe("agent:build-specialist");
  });

  it("withholds and names the missing pre-authorisation", () => {
    const decision = decideAuthorStageAutonomy({
      shapeKey: "delivery-small",
      preauthorisation: { state: "not-in-force", because: "No operator pre-authorisation is recorded." },
      funding: FUNDED,
    });
    expect(decision.roleBindings).toEqual({});
    expect(decision.withheldBecause).toMatch(/No operator pre-authorisation is recorded/);
  });

  it("withholds and names the missing funding", () => {
    const decision = decideAuthorStageAutonomy({
      shapeKey: "delivery-break-fix",
      preauthorisation: IN_FORCE,
      funding: { funded: false, because: "No budget is set for Foundational this quarter." },
    });
    expect(decision.roleBindings).toEqual({});
    expect(decision.withheldBecause).toMatch(/No budget is set/);
  });

  it("never binds an xlarge room: xlarge never enters implementation", () => {
    const decision = decideAuthorStageAutonomy({ shapeKey: "delivery-xlarge", preauthorisation: IN_FORCE, funding: FUNDED });
    expect(decision.roleBindings).toEqual({});
    expect(decision.withheldBecause).toMatch(/xlarge/);
  });

  it("leaves non-delivery shapes untouched", () => {
    expect(decideAuthorStageAutonomy({ shapeKey: "acceptance-verification", preauthorisation: IN_FORCE, funding: FUNDED }))
      .toEqual({ roleBindings: {}, withheldBecause: null });
  });
});
