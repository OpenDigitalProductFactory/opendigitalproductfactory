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
    hasLiveWorkroom: true,
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

function budget(allocatedPoints: number | null): PortfolioBudgetStatus {
  return {
    id: "pf-found",
    slug: "foundational",
    name: "Foundational",
    budget: allocatedPoints === null ? null : {
      id: "budget-1", allocatedPoints, usdPerPoint: null, wipAllowancePoints: null,
      setById: "user-op", setByAgentId: null, reason: "derived", supersedesId: null, createdAt: NOW,
    },
  };
}

describe("buildAuthorStageFunding (BI-8A32EBFF AC-1: within budget)", () => {
  it("is funded when the item's portfolio has a budget and its committed points fit", () => {
    const funding = buildAuthorStageFunding({ items: [item()], budgets: [budget(20)], now: NOW })("BI-1");
    expect(funding.funded).toBe(true);
  });

  it("treats no budget set as NOT funded, and says so (never read as zero)", () => {
    const funding = buildAuthorStageFunding({ items: [item()], budgets: [budget(null)], now: NOW })("BI-1");
    expect(funding).toMatchObject({ funded: false });
    if (!funding.funded) expect(funding.because).toMatch(/No budget is set for Foundational this quarter/);
  });

  it("is not funded when the portfolio's delivered plus in-flight points exceed its allocation", () => {
    const items = [item(), item({ itemId: "BI-2", effortSize: "large" })];
    const funding = buildAuthorStageFunding({ items, budgets: [budget(8)], now: NOW })("BI-1");
    expect(funding.funded).toBe(false);
    if (!funding.funded) expect(funding.because).toMatch(/11 of 8 points/);
  });

  it("is not funded for unattributed, unsized, unknown or unbound work", () => {
    const build = buildAuthorStageFunding({
      items: [item({ itemId: "BI-U", storedPortfolioId: null, scopeKind: "archetype-leaf" }), item({ itemId: "BI-S", effortSize: null })],
      budgets: [budget(50)],
      now: NOW,
    });
    expect(build("BI-U")).toMatchObject({ funded: false, because: expect.stringMatching(/reaches no portfolio/) });
    expect(build("BI-S")).toMatchObject({ funded: false, because: expect.stringMatching(/no size/) });
    expect(build("BI-NONE")).toMatchObject({ funded: false, because: expect.stringMatching(/not live work/) });
    expect(build(null)).toMatchObject({ funded: false, because: expect.stringMatching(/bound to no backlog item/) });
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
