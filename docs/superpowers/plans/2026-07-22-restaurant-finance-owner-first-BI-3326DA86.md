# Restaurant finance owner-first + progressive disclosure (plan)

**BI:** BI-3326DA86 (with supporting changes from BI-3BCAF95F)
**Date:** 2026-07-22
**Guiding outcome:** for a food-hospitality / Restaurant business, the finance
first screen should answer **"what money needs attention today?"** in the owner's
language, and defer the accountant/back-office internals behind clear advanced
sections.

## Problem

The finance overview (`apps/web/app/(shell)/finance/page.tsx`) renders an
identical, accountant-shaped surface for every org: Revenue / Spend / Close /
Configuration cards, a Bookkeeper/Accountant work lane, and a wall of AR/AP/
Procurement/Banking/Reports/People/Management/Settings link columns. For an
owner-operated restaurant this is the wrong first screen — it leads with ledger
internals (VAT remittance, dunning, payment runs, GL reports, bank rules, AI
spend) instead of the money jobs a restaurateur actually watches: booking
deposits, event/catering balances, order/ticket payments, supplier bills,
payouts/reconciliation, and no-show/cancellation fees.

The generic invoice flow compounds this: it starts only from a customer dropdown
and uses professional-services helper copy ("engagement letters and service
agreements"). And the payment-run builder said "Execute Payment Run" / "Confirm &
Pay" / "This will pay … cannot be undone", implying a real, irreversible bank
transfer — when `createPaymentRun` only records an internal completed payment and
marks bills paid (no bank rail).

## Design grounding

- **Source of truth:** the archetype/finance mapping already lives in
  `apps/web/lib/finance/setup-profile.ts` (`financeProfileSlugFromCategory`) and
  `packages/finance-templates/src/profiles.ts` (`food_hospitality` profile,
  point-of-sale billing pattern). This work **extends** that substrate; it does
  not fork a new archetype system.
- **No new data models.** The substrate sweep confirmed there are no
  Restaurant-specific money tables (no booking-deposit / catering-balance /
  no-show-fee / payout models). Restaurant money already flows through the
  generic `Invoice` / `Payment` / `Bill` / `BankTransaction` tables, with
  `Invoice.sourceType` / `sourceId` linking back to a booking or order. The
  owner-first surface is therefore an **honest re-framing of existing finance
  data**, not a promise of new records — every money job and link points at a
  real finance route.
- **Archetype-scoping pattern** mirrors the dependency-free pure-resolver style
  of `apps/web/lib/finance/invoice-signature-default.ts` and the category-keyed
  registry of `apps/web/lib/workspace-home/profiles.ts`.

## Changes

1. **`apps/web/lib/finance/finance-surface.ts`** (new, pure, dependency-free):
   `resolveFinanceSurface(category)` returns an owner-first surface for
   `food-hospitality` (money jobs + Restaurant invoice entry points + deferred
   advanced sections) and a `standard` surface for every other/unknown category.
   Also `resolveFinanceInvoiceCopy(category)` swaps professional-services invoice
   copy for Restaurant language, and small guards (`isOwnerFirstFinanceCategory`,
   `isFinanceInvoiceContext`).

2. **`apps/web/components/finance/OwnerFirstFinanceView.tsx`** (new): presentational
   view that leads with the money-jobs grid and pushes every accounting internal
   (VAT, dunning, payment runs, GL reports, bank rules, AI spend, the accountant
   work lane) into a collapsed, clearly-labelled `Accounting & admin` `<details>`.

3. **`apps/web/app/(shell)/finance/page.tsx`**: reads the storefront archetype
   category, resolves the surface, and branches — owner-first renders
   `OwnerFirstFinanceView` (re-using the same live figures already queried);
   every other archetype keeps the existing generic layout unchanged.

4. **Restaurant invoice entry points + copy** (`invoices/new/page.tsx`,
   `CreateInvoiceForm.tsx`): `?from=booking|order|catering|private-event|no-show`
   gives a contextual heading, an entry-point chooser, a context badge, and
   Restaurant helper copy (guest/catering language) instead of only a generic
   customer dropdown. Defaults preserve professional-services copy for other
   archetypes.

5. **Payment-run disclosure** (`PaymentRunBuilder.tsx`): a disclosure shown
   **before** any bill is selected states plainly that recording a payment run
   marks the selected bills as paid in DPF and is **not a draft** and does **not
   initiate a real bank transfer**. Action labels changed from
   "Execute Payment Run" / "Confirm & Pay" to "Record as Paid".

## Tests

- `apps/web/lib/finance/finance-surface.test.ts` — food-hospitality resolves
  owner-first with the Restaurant money jobs, does **not** lead with
  accountant/internal routes, defers VAT/dunning/payment-runs/GL/bank-rules/
  AI-spend into advanced sections; non-food-hospitality stays standard.
- `apps/web/components/finance/OwnerFirstFinanceView.test.tsx` — Restaurant money
  jobs + live figures render, internals sit inside the collapsed advanced region
  (money jobs appear before the advanced heading), and the internal links are
  deferred-not-dropped.
- `apps/web/components/finance/PaymentRunBuilder.test.tsx` — disclosure semantics
  render before bill selection and the misleading "Execute Payment Run" label is
  gone.

## Out of scope / follow-ups

- Real booking→invoice prefill (reading `StorefrontBooking`/`StorefrontOrder`
  into the invoice draft) is a data feature for a later BI; today the entry
  points carry context via query param and framing only.
- Charging a no-show/cancellation fee is surfaced as an entry point into the
  generic invoice flow; a first-class fee model is a later BI.
