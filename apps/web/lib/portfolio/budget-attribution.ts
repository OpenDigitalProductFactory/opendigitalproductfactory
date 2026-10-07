// Budget attribution: the one place an item's budget portfolio is decided
// (BI-291F7451). The read model, the budget proposal, throughput, the tie-out
// and points-in-flight admission all read this, so a budget and the work that
// consumes it are attributed alike.
//
// Order: an explicit portfolio (stored, digital product, taxonomy node,
// coworker need, epic) wins. Failing that, platform or common work counts as
// Foundational, and so does work that was never scoped (no scopeKind, or
// "unknown") — both operator decisions of 2026-10-07. Archetype-scoped work is
// unallocated and stays reported as such. The rule is derived at read time; item data is not
// rewritten.
//
// Spec: docs/superpowers/specs/2026-09-24-portfolio-budget-and-investment-wip-design.md

import { resolveBacklogPortfolioWithPath, type BacklogPortfolioPath } from "@dpf/db/backlog-portfolio";

/** Item scopes whose work counts as Foundational when no portfolio is explicit. */
export const PLATFORM_DEFAULT_SCOPE_KINDS = ["platform", "common"] as const;
/** Never-scoped work counts as Foundational too (operator decision 2026-10-07). */
const UNSCOPED_SCOPE_KINDS: ReadonlySet<string> = new Set(["unknown"]);

export type BudgetAttributionBasis = "explicit" | "platform-default" | "unallocated";
export type BudgetPortfolioPath = BacklogPortfolioPath | "platform-default";

/** The links attribution reads, as the investment loader selects them. */
export type BudgetAttributionInput = {
  storedPortfolioId: string | null;
  /** The stored portfolioId names no Portfolio row. */
  storedPortfolioDangling: boolean;
  productPortfolioId: string | null;
  taxonomyPortfolioId: string | null;
  coworkerNeedPortfolioId: string | null;
  epicPortfolioId: string | null;
  /** BacklogItem.scopeKind as stored (e.g. "platform", "archetype-leaf"). */
  scopeKind?: string | null;
  /** The Foundational portfolio's id on this install; null when it has none. */
  platformDefaultPortfolioId?: string | null;
};

export type BudgetPortfolioAttribution = {
  portfolioId: string | null;
  path: BudgetPortfolioPath;
  basis: BudgetAttributionBasis;
  /** The stored portfolioId names a different portfolio than the links do. */
  disagreesWithLinks: boolean;
};

const PLATFORM_DEFAULT = new Set<string>(PLATFORM_DEFAULT_SCOPE_KINDS);

export function resolveBudgetPortfolio(item: BudgetAttributionInput): BudgetPortfolioAttribution {
  const explicit = resolveBacklogPortfolioWithPath({
    // A stored id naming no portfolio would open a row no budget can match.
    portfolioId: item.storedPortfolioDangling ? null : item.storedPortfolioId,
    digitalProduct: { portfolioId: item.productPortfolioId },
    taxonomyNode: { portfolioId: item.taxonomyPortfolioId },
    coworkerNeeds: [{ agent: { portfolioId: item.coworkerNeedPortfolioId } }],
    epic: { portfolios: item.epicPortfolioId ? [{ portfolioId: item.epicPortfolioId }] : [] },
  });
  if (explicit.portfolioId) return { ...explicit, basis: "explicit" };
  const neverScoped = !item.scopeKind || UNSCOPED_SCOPE_KINDS.has(item.scopeKind);
  if (item.platformDefaultPortfolioId && (neverScoped || PLATFORM_DEFAULT.has(item.scopeKind!))) {
    return { portfolioId: item.platformDefaultPortfolioId, path: "platform-default", basis: "platform-default", disagreesWithLinks: false };
  }
  return { portfolioId: null, path: "unallocated", basis: "unallocated", disagreesWithLinks: false };
}
