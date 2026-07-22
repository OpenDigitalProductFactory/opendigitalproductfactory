# Food & hospitality subtype money jobs — Restaurant / Catering / Bakery (plan)

**BI:** BI-3326DA86 (next slice, after PR #3416)
**Date:** 2026-07-22
**Guiding outcome:** a caterer and a bakery should not be shown a restaurant's
money jobs. Narrow the owner-first finance surface from the food-hospitality
*category* down to the archetype *subtype*.

## Problem

PR #3416 shipped the owner-first finance surface keyed on
`StorefrontArchetype.category === "food-hospitality"`, so Restaurant, Catering,
and Bakery installs all received the same six money jobs and the same invoice
entry points. The backlog evidence on BI-3326DA86 (Twin Gallery pass, 2026-07-22)
called this out directly: Catering needs quote → deposit → event invoice →
balance due and staffing/menu cost; Bakery needs standard counter sale vs custom
cake deposit/balance and pickup/delivery fees. Showing a bakery "no-show &
cancellation fees" and "table orders" is the same category error the BI was
raised to fix, one level down.

## Design grounding

- **Source of truth:** `apps/web/lib/finance/finance-surface.ts` (shipped in
  #3416) — this slice extends that resolver rather than forking a second one.
- **Subtype ids** come from `packages/storefront-templates/src/archetypes/food-hospitality.ts`,
  which defines exactly three: `restaurant`, `catering`, `bakery`. These are
  `StorefrontArchetype.archetypeId`; the category stays `food-hospitality`.
- **No new data models.** Still no Restaurant/Catering/Bakery money tables — the
  same five real figures (`Invoice`/`Payment`/`Bill`/`BankTransaction` derived)
  are re-framed in each subtype's language. Subtype differentiation is in the
  label, question, and action, not in invented metrics.

## Changes

1. **`resolveFinanceSurface(category, archetypeId?)`** — optional second
   argument, so existing single-argument callers keep working. Resolves a
   `FoodHospitalitySubtype` (`restaurant` | `catering` | `bakery` | `generic`)
   and returns that subtype's money jobs, entry points, and subhead. `generic`
   is the fallback for a food-hospitality install whose `archetypeId` is not one
   of the three, so no install regresses to the standard accountant surface.
2. **Money jobs per subtype** — Catering leads with event deposits/balances,
   event payments, ingredient & staffing bills, and "Quote a catering job";
   Bakery leads with custom-order deposits/balances, counter takings, ingredient
   bills, and "Bill a custom order". Restaurant is unchanged from #3416.
3. **Invoice entry points + copy per subtype** — Catering gains
   `quote` / `event-deposit` / `event-balance`; Bakery gains
   `custom-order` / `counter-sale` / `delivery`. `FinanceInvoiceContext` and the
   copy map expand accordingly; `contexts` becomes `Partial` with a fallback to
   the generic heading so an unmapped context degrades gracefully.
4. **Callers** — `/finance` now selects `archetypeId` alongside `category`;
   `/finance/invoices/new` passes both to the resolver and the copy resolver, and
   the context badge falls back to the context copy title.

## Honesty invariant (tested)

Each live metric is used by **at most one money job per subtype**. If two jobs
claimed the same metric the owner would see one number presented under two
different names. `finance-surface.test.ts` asserts this for every subtype, and
also re-asserts per subtype that accounting internals never lead the surface and
are never dropped (only deferred).

## Tests

- `finance-surface.test.ts` — subtype resolution + fallback; per-subtype
  invariants (owner-first, no internal routes leading, internals deferred, no
  duplicated metric, blank-invoice escape hatch); Restaurant/Catering/Bakery
  money-job and entry-point sets; explicit "subtypes are actually differentiated"
  checks; per-subtype copy; expanded context guard.
- `OwnerFirstFinanceView.test.tsx` — renders Catering jobs (and *not* Restaurant
  no-show) for a catering install, and Bakery jobs for a bakery install.

## Out of scope

- Prefilling invoices from a real booking/order — **BI-5CC7392C**.
- A first-class no-show/cancellation fee policy with a waive path — **BI-1AF3CE43**.
- The remaining BI-3326DA86 clause "coworker can draft readiness notes".
