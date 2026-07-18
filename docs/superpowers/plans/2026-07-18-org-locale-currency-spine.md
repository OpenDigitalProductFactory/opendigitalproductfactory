# Org locale & currency spine — retire the British-by-default bias

- **Epic:** EP-ORG-LOCALE-CURRENCY
- **Backlog item:** BI-0530BB74
- **Kernel decision ledger:** DI-92BCDA20FB94
- **Status:** Phase 1 implemented (this PR); Phases 2–3 follow-up.

## Problem

DPF was British-by-default. `currency` defaulted to `GBP` across ~24
finance/commerce models, `StorefrontConfig.timezone` defaulted to
`Europe/London`, and money was formatted per-surface with ad-hoc
`toLocaleString("en-GB")`. There was **no org-level currency/locale/country
source**, so a non-UK operator (e.g. a US business) saw `£`, en-GB grouping, and
UK dates everywhere — including the operational twin the operator flagged.

Substrate that already existed and is reused rather than reinvented:
- `OrgSettings` — the single-org settings singleton, with `baseCurrency` (app
  create-default was already `USD`, but the schema column default was `GBP`).
- `OrganizationTaxProfile.homeCountryCode` / `OrganizationLicenseProfile.homeCountryCode`
  — onboarding already captures the operator's home country.
- `apps/web/lib/actions/currency.ts` — `getOrgSettings` / `updateBaseCurrency`.

## Design

`OrgSettings` becomes the canonical locale/currency source of truth; the org's
values are **derived from the operator's own country**, never a hardcoded foreign
default. One shared module gives every surface a resolver + a formatter.

### Phase 1 — spine + the twin (this PR)

1. **`apps/web/lib/org-locale/org-locale.ts`** (pure + one injected-client
   resolver):
   - `deriveLocaleCurrencyFromCountry(iso2)` — ISO-3166 alpha-2 → `{currency, locale}`
     (curated map of common operator countries; unknown → neutral `USD/en-US`).
   - `formatMoney(amount, currency, locale?, opts?)` — the one money formatter
     (Intl, currency's own locale by default). Replaces per-file `en-GB` hardcoding.
   - `resolveOrgLocale(db)` — reads `OrgSettings`, falls back to country
     derivation then the neutral default; never throws.
2. **`OrgSettings`** gains `locale` (`@default("en-US")`) and `countryCode`;
   `baseCurrency` default flips `GBP → USD`.
3. **Schema defaults**: the ~24 `@default("GBP")` currency columns → `USD`;
   `StorefrontConfig.timezone` `Europe/London → UTC`. Migration
   `20260718120000_org_locale_currency_spine` (defaults + backfill of the
   existing `OrgSettings` row: `locale` from `baseCurrency`, `countryCode` from
   the tax profile). **Existing amounts are not re-denominated.**
4. **Operational twin** (`lib/twin/living-business-snapshot.ts`) reads
   `resolveOrgLocale` for currency + locale instead of inferring currency from a
   bill row, and formats via the shared `formatMoney`.
5. **Onboarding wiring**: `applyOrgCountry(countryCode)` (in `currency.ts`) syncs
   `OrgSettings.countryCode` + initializes currency/locale from the country the
   first time it is captured; called from `updateOrganizationTaxProfile`.

### Phase 2 — adopt the shared formatter everywhere (follow-up)

~40 surfaces still format money with local helpers (`formatMoney`,
`formatCurrency`, inline `Intl`/symbol maps) across finance tables, invoices,
bills, CRM, storefront. Mechanically migrate them to `@/lib/org-locale`
`formatMoney` + `resolveOrgLocale`, verifying each surface on the running portal.
This is deferred because it needs per-surface functional verification, not a
blind sweep.

### Phase 3 — existing-data re-denomination (follow-up, operator-visible)

For an install that already wrote real `GBP` rows, decide (with the operator)
whether to re-denominate or leave historical amounts. Never silently relabel a
persisted amount's currency.

## Verification

- Phase 1: `org-locale.test.ts` (pure derivation/format/resolve) + updated
  `living-business-snapshot.test.ts` (twin renders the org currency, not the bill
  row). CI typecheck/build/unit gate the migration + schema.
- Functional: a fresh US-country install (or `OrgSettings.countryCode = "US"`)
  renders `$` + US grouping on the twin; GBP no longer appears by default.
