import { describe, expect, it } from "vitest";

import { PLATFORM_DEFAULT_SCOPE_KINDS, resolveBudgetPortfolio, type BudgetAttributionInput } from "./budget-attribution";

const FOUNDATIONAL = "pf-foundational";

function item(overrides: Partial<BudgetAttributionInput>): BudgetAttributionInput {
  return {
    storedPortfolioId: null, storedPortfolioDangling: false, productPortfolioId: null, taxonomyPortfolioId: null,
    coworkerNeedPortfolioId: null, epicPortfolioId: null, scopeKind: null, platformDefaultPortfolioId: FOUNDATIONAL,
    ...overrides,
  };
}

describe("resolveBudgetPortfolio (BI-291F7451)", () => {
  it("lets an explicit portfolio win over the platform default", () => {
    expect(resolveBudgetPortfolio(item({ scopeKind: "platform", storedPortfolioId: "p-work" })))
      .toEqual({ portfolioId: "p-work", path: "stored", basis: "explicit", disagreesWithLinks: false });
    expect(resolveBudgetPortfolio(item({ scopeKind: "common", epicPortfolioId: "p-sold" })))
      .toMatchObject({ portfolioId: "p-sold", path: "epic", basis: "explicit" });
  });

  it.each(PLATFORM_DEFAULT_SCOPE_KINDS)("attributes %s work with no portfolio to Foundational, by rule", (scopeKind) => {
    expect(resolveBudgetPortfolio(item({ scopeKind })))
      .toEqual({ portfolioId: FOUNDATIONAL, path: "platform-default", basis: "platform-default", disagreesWithLinks: false });
  });

  it("ignores a dangling stored portfolio, so the rule still applies", () => {
    expect(resolveBudgetPortfolio(item({ scopeKind: "platform", storedPortfolioId: "gone", storedPortfolioDangling: true })))
      .toMatchObject({ portfolioId: FOUNDATIONAL, basis: "platform-default" });
  });

  // Operator decision 2026-10-07 (second): work that was never scoped also counts
  // as Foundational — 391 finished items with no scopeKind carried ~1,212 points.
  it.each([null, "unknown"])("counts never-scoped (%s) work with no portfolio as Foundational", (scopeKind) => {
    expect(resolveBudgetPortfolio(item({ scopeKind })))
      .toMatchObject({ portfolioId: FOUNDATIONAL, path: "platform-default", basis: "platform-default" });
  });

  it.each(["archetype-category", "archetype-leaf", "multi-archetype"])(
    "leaves %s-scoped work with no portfolio unallocated",
    (scopeKind) => {
      expect(resolveBudgetPortfolio(item({ scopeKind })))
        .toEqual({ portfolioId: null, path: "unallocated", basis: "unallocated", disagreesWithLinks: false });
    },
  );

  it("leaves platform work unallocated when the install has no Foundational portfolio", () => {
    expect(resolveBudgetPortfolio(item({ scopeKind: "platform", platformDefaultPortfolioId: null })))
      .toMatchObject({ portfolioId: null, basis: "unallocated" });
  });
});
