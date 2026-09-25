---
status: active
---

# Currency defaults fix: stop inventing GBP, apply the setup country, keep minor units

- **Backlog item:** `BI-6030131C` (epic `EP-6B33A840`). This is the foundation fix ahead of L0.5 and L0.7.
- **Profile:** fix. This document is the ordered fix design and the reproduction record.
- **Parent design:** `docs/superpowers/specs/2026-09-24-localization-and-multi-currency-architecture-design.md` §3.

## Reproduction (run, not read)

Failing tests were written first, on base `origin/main` `1531ff7f`.

| Test | Result on base |
|---|---|
| `storefront-actions.test.ts` › *records an order without a currency in the workspace's own currency* | **fails**: expected `'GBP'` to be `'USD'` with `OrgSettings.baseCurrency = USD` |
| `business-context/setup/route.test.ts` › *syncs the org's currency and locale from the country captured in setup* | **fails**: `applyOrgCountry` never called with `'MX'` |
| `org-locale.test.ts` › *keeps the currency's minor units by default* | **fails**: `formatMoney(1234.5, "USD")` returned `'$1,235'` |
| `org-locale.test.ts` › `resolveOrgBaseCurrency` (3 cases) | **fail**: the resolver is private to `storefront-actions.ts` |

Totals: 8 failed, 36 passed.

**Causes ruled out, by running:**
- **The donation path is not affected.** It was already fixed in #4848, and its three tests pass in the same run.
- **The test harness is sound.** The existing setup-route tests pass.
- **ICU/Intl data is fine.** An explicit `maximumFractionDigits: 2` yields `'$1,234.50'` in the same run.

## Defects and root cause

There is no shared "the org's currency" resolver. As a result:

1. **Every path with no currency invents GBP.** Affected code:

   | Location | What it does |
   |---|---|
   | `lib/storefront/storefront-actions.ts:573` | storefront orders |
   | `lib/finance/ledger-service.ts:426,517` | manual and opening-balance journals |
   | `lib/finance/period-summary.ts:258,265,295` | |
   | `lib/hr/labor-service.ts:232` | |
   | `customer/(crm)/[id]/page.tsx:321`, `employee/page.tsx:368`, `finance/settings/rate-card/page.tsx:63` | shell pages |
   | `lib/crm/pipeline-inspector.ts:314,342` | |
   | `lib/finance/tax-remittance-core.ts:253,301` | |
   | `lib/actions/tax-remittance.ts:396` | |
   | `components/customer/NewOpportunityButton.tsx:40` | |
   | `components/finance/CreatePOForm.tsx:43` | |
   | 7 zod schemas | `.default("GBP")` |
   | `applyFinancialProfile` | falls back to the profile's `defaultCurrency`, which is GBP in 14 of 19 profiles |

2. **The country chosen at setup never reaches `OrgSettings`.** `applyOrgCountry` is called only from tax setup.
3. **The shared `formatMoney` rounds to whole units by default,** so it drops minor units.

## Ordered fix

1. **Export `resolveOrgBaseCurrency(db)` from `lib/org-locale`.** It uses the injected-client pattern of `resolveOrgLocale`. The order of preference is:
   - `OrgSettings.baseCurrency`
   - otherwise, a currency derived from `countryCode`
   - otherwise, `USD`

   Delete the private copy in `storefront-actions.ts`.
2. **Route every fallback in defect 1 through the resolver.**
   - Server code awaits it.
   - Client components receive the org currency as a prop from their server parent.
3. **Validation schemas stop defaulting currency.** Each field becomes `.optional()`, and the action or route that persists the value fills it from the resolver. A validator should not decide the org's currency.
4. **`applyFinancialProfile` prefers the org's resolved currency** over the profile default when the operator gave none.
5. **The business-context setup route calls `applyOrgCountry(countryCode)`** when an address with a country is saved. The call is first-country-only by design, so an explicit operator currency is never overwritten.
6. **`formatMoney` defaults to the currency's own minor units** (Intl default: USD 2, JPY 0, BHD 3). Headline tiles that want whole numbers pass `maximumFractionDigits: 0` explicitly, so the twin and cockpit render as before.

**Out of scope:**
- The currency picker option lists. These belong to L1.1, `BI-BAC971B2`.
- Locale heuristics such as `revenue-cockpit.ts:62`. These belong to L0.5.
- Re-denominating existing rows. The rule is never do it silently, and that is L1.2.

## Verification

- The reproduction tests pass after the fix, and the affected-package unit tests stay green.
- `pnpm --filter web typecheck`.
- Portal check with `OrgSettings.baseCurrency=USD`:
  - A storefront order with no currency stores USD.
  - Setup with country MX sets MXN/es-MX.
  - Twin tiles render unchanged.
