# Phase 2D — Portfolio Investment Metric Design

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Wire up the Investment stat box in portfolio views using a `Portfolio.budgetKUsd` field seeded with placeholder values.

---

## Overview

Phase 2A introduced a dashed Investment placeholder. Phases 2B and 2C wired up Agent counts and Health. Phase 2D wires up **Investment** — the annual budget (in thousands of USD) for each of the four portfolio roots — using a new nullable field on the `Portfolio` model.

**Investment definition:**

> Annual budget for the portfolio, stored as `Int?` (thousands of USD) on the `Portfolio` model. Displayed as `"$2.5M"` (≥$1M), `"$800k"` (<$1M), or `"—"` when null, zero, or negative.

Investment is a **portfolio-level metric** — it does not subdivide into L1/L2/L3 nodes. All nodes within a portfolio display the same portfolio budget (consistent with how `agentCount` shows the portfolio's total agent count at all depths).

**Placeholder seed values** (fictional, for demonstration):

| Portfolio slug | `budgetKUsd` | Formatted |
|---|---|---|
| `foundational` | `2500` | `$2.5M` |
| `manufacturing_and_delivery` | `1800` | `$1.8M` |
| `for_employees` | `1200` | `$1.2M` |
| `products_and_services_sold` | `3500` | `$3.5M` |

---

## What Changes

### 1. Schema — add `budgetKUsd` to `Portfolio`

`packages/db/prisma/schema.prisma`

```prisma
model Portfolio {
  // existing fields …
  budgetKUsd  Int?     // annual budget in $k — null means unset/unknown
}
```

### 2. Migration

```bash
pnpm --filter @dpf/db migrate dev --name add_budget_to_portfolio
```

Generates SQL: `ALTER TABLE "Portfolio" ADD COLUMN "budgetKUsd" INTEGER;`

### 3. Seed — update `seedPortfolios()`

`packages/db/src/seed.ts`

Add a static map of placeholder budgets and apply during upsert:

```ts
const PORTFOLIO_BUDGETS: Record<string, number> = {
  foundational: 2500,
  manufacturing_and_delivery: 1800,
  for_employees: 1200,
  products_and_services_sold: 3500,
};

// Inside the upsert:
budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null,
```

The `PORTFOLIO_BUDGETS` map uses `p.id`, which is the `portfolio_registry.json` slug string (e.g. `"foundational"`, `"manufacturing_and_delivery"`) — this is the same string stored in `Portfolio.slug`, and is **not** the Prisma-generated cuid `Portfolio.id`.

### 4. `formatBudget` — new pure function

`apps/web/lib/portfolio.ts`

```ts
/** Format a portfolio budget (thousands USD) as a display string.
 *  Returns "—" when null, zero, or negative. */
export function formatBudget(kUsd: number | null | undefined): string {
  if (kUsd == null || kUsd <= 0) return "—";
  if (kUsd >= 1000) return `$${(kUsd / 1000).toFixed(1)}M`;
  return `$${kUsd}k`;
}
```

Exported from `portfolio.ts` — pure, no DB calls, safe for client components.

### 5. `getPortfolioBudgets` — new server cache function

`apps/web/lib/portfolio-data.ts`

```ts
/**
 * Returns annual budget per portfolio slug, e.g. { foundational: "$2.5M", ... }.
 * Returns "—" for portfolios with null budget.
 */
export const getPortfolioBudgets = cache(async (): Promise<Record<string, string>> => {
  const portfolios = await prisma.portfolio.findMany({
    select: { slug: true, budgetKUsd: true },
  });
  return Object.fromEntries(
    portfolios.map((p) => [p.slug, formatBudget(p.budgetKUsd)])
  );
});
```

Import `formatBudget` from `./portfolio` (bare import, no `.js`).

### 6. `page.tsx` — fetch budgets and derive investment string

`apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx`

Add `getPortfolioBudgets` to imports. Fetch alongside tree + agent counts:

```ts
const [roots, agentCounts, budgets] = await Promise.all([
  getPortfolioTree(),
  getAgentCounts(),
  getPortfolioBudgets(),
]);
```

For overview:
```tsx
<PortfolioOverview roots={roots} agentCounts={agentCounts} budgets={budgets} />
```

For node detail — investment is portfolio-level, use `rootSlug`:
```ts
const investment = budgets[rootSlug] ?? "—";
```
```tsx
<PortfolioNodeDetail ... investment={investment} />
```

### 7. `PortfolioOverview` — add Investment stat

Add `budgets: Record<string, string>` to Props. Show after Health:

```tsx
<div>
  <p className="text-sm font-bold" style={{ color: colour }}>
    {budgets[root.nodeId] ?? "—"}
  </p>
  <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">
    Budget
  </p>
</div>
```

Card stat order: Products · Owner · Agents · Health · Budget.

**Key note:** `budgets` is keyed by `Portfolio.slug`. For root-level portfolio cards, `root.nodeId` equals the portfolio slug (e.g. `"foundational"`), so `budgets[root.nodeId]` is correct. This matches the existing `agentCounts[root.nodeId]` pattern already used in this component.

**Label note:** Use `"Budget"` rather than `"Investment"` — it's more precise for what `budgetKUsd` represents.

### 8. `PortfolioNodeDetail` — replace dashed Investment placeholder

`apps/web/components/portfolio/PortfolioNodeDetail.tsx`

Add `investment: string` to Props. Replace:

```tsx
// Before:
<StatBox label="Investment" value="—" colour="#555566" dashed />

// After:
<StatBox label="Budget" value={investment} colour={colour} />
```

---

## Component / Data Flow

```
packages/db: Portfolio.budgetKUsd (seeded with placeholder values)

portfolio-data.ts: getPortfolioBudgets()
  ├─ prisma.portfolio.findMany({ select: { slug, budgetKUsd } })
  └─ formatBudget(p.budgetKUsd) → "$2.5M" / "—"
  → Record<portfolioSlug, formattedString>

page.tsx (overview):
  PortfolioOverview ← budgets: Record<slug, string>

page.tsx (node detail):
  investment = budgets[rootSlug] ?? "—"   // portfolio-level, same at all depths
  PortfolioNodeDetail ← investment: string
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `budgetKUsd Int?` to `Portfolio` |
| `packages/db/prisma/migrations/…` | New migration |
| `packages/db/src/seed.ts` | Add `PORTFOLIO_BUDGETS` map; pass `budgetKUsd` in upsert |
| `apps/web/lib/portfolio.ts` | Add `formatBudget` pure function |
| `apps/web/lib/portfolio.test.ts` | Add `describe("formatBudget()")` tests |
| `apps/web/lib/portfolio-data.ts` | Add `getPortfolioBudgets` cache function |
| `apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx` | Add `getPortfolioBudgets` fetch; pass `budgets` / `investment` |
| `apps/web/components/portfolio/PortfolioOverview.tsx` | Add `budgets` prop + Budget stat div |
| `apps/web/components/portfolio/PortfolioNodeDetail.tsx` | Replace dashed Investment with live `investment` prop |

---

## Testing

All tests in `apps/web/lib/portfolio.test.ts` (Vitest, `environment: "node"`).

| Test | Expected |
|---|---|
| `formatBudget(null)` | `"—"` |
| `formatBudget(0)` | `"—"` |
| `formatBudget(800)` | `"$800k"` |
| `formatBudget(1000)` | `"$1.0M"` |
| `formatBudget(2500)` | `"$2.5M"` |
| `formatBudget(undefined)` | `"—"` |
| `formatBudget(-1)` | `"—"` |

`getPortfolioBudgets` and `seedPortfolios` are server/DB functions — not unit-testable without live DB. Validated via TypeScript check.

---

## What This Does Not Include

- Per-node investment subdivision (budget belongs to portfolio only)
- Investment trend / YoY comparison — future phase
- `/inventory` and `/ea` routes — separate specs
- People panel live data — future phase
