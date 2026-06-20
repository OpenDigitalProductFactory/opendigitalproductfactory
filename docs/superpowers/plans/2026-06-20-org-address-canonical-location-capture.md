# Capture the Organization's Address as the Canonical, Precise Location Source

**Date:** 2026-06-20
**Epic:** EP-INSTALL-HARDENING-2026-05-23 (First-run install path hardening)
**Item:** BI-AAAA0691
**Builds on:** BI-6DA3B06F (#2199, Operating Hours timezone picker), BI-0C000AB3 (#2201,
derive timezone from captured location), BI-A077E0F5 (capture business location + confirmed tz).

## Why

`Organization.address` is DPF's canonical address field (AGENTS.md §11 — *any feature
needing org address reads from `Organization`*), but it is **never captured during setup**
and is empty on installs (verified on the live `dpf` Postgres). The downstream cost showed
up first in the self-upgrade window: with no captured location, the maintenance window
evaluated in UTC and landed at local noon for a US Central store (BI-6DA3B06F).

#2201 wired a *derivation* path (`deriveTimezoneFromBusinessLocation` → `resolveTimezoneFromLocation`)
that reads `BusinessContext.stateCode` + `operatesIn`. Two gaps remain:

1. **`BusinessContext.stateCode` is never captured by any setup form** — so the precise US
   state signal the derivation wants is always absent, and the country-only fallback puts
   every US business on `America/New_York` (Eastern), wrong for ~70% of US.
2. **The canonical address itself is never captured.** The account-setup wizard writes a
   legacy `{ location, timezone }` blob (`setup-entities.ts createOrganization`) that the
   address readers (`org-identity.formatAddress`) don't even understand, so invoices/emails
   and the directory `nearby` route see an empty address.

This BI closes both: capture a real structured address at setup (and make it editable in
business settings), persist it to `Organization.address`, and use it as the **precise**
timezone source — a US address resolves to a state-accurate IANA zone, which the operator
confirms (never types) via the existing Operating Hours picker.

## Substrate audit (what already exists — reuse, don't rebuild)

- **`Organization.address Json?`** — canonical home (AGENTS.md §11). Already read by several
  consumers, each with its own key expectations:
  - `org-identity.ts formatAddress` → invoice/email lines. Keys: `line1, line2, street, city,
    region, state, county, postalCode, postcode, zip, country` (dedupes).
  - `marketing.ts summarizeAddress` → `city, region, state, country`.
  - `release/storefront-data.ts` → cast to `StorefrontAddress { street, city, postcode, country }`.
  - `api/v1/directory/nearby/route.ts` → `city, region` + `latitude/longitude` (geocoding).
  - **Consensus canonical keys:** `line1, line2, city, region, postalCode, country` (+ optional
    `latitude/longitude`). A new write must stay compatible with all of these.
- **`#2201` timezone derivation** — `apps/web/lib/timezone-from-location.ts`
  (`US_STATE_TO_TIMEZONE`, `COUNTRY_TO_TIMEZONE`, `resolveTimezoneFromLocation`) and
  `operating-hours-read.ts deriveTimezoneFromBusinessLocation`. Both the editor
  (`getOperatingHours`) and the cron (`resolveOperatingScheduleForSystem`) funnel through
  `deriveTimezoneFromBusinessLocation` — so upgrading that one function covers both paths.
- **Business-context capture surface** — `apps/web/components/admin/BusinessContextForm.tsx`
  + `apps/web/app/api/business-context/setup/route.ts` + page
  `app/(shell)/storefront/settings/business/page.tsx`. The form already practises
  progressive disclosure (cross-border compliance is opt-in).
- **`BusinessContext.stateCode String?`** — exists for public-sector statutory defaults;
  currently uncaptured. We populate it from the address's US state so the civic feature and
  the timezone derivation share one captured signal.

**Decision — do NOT reuse the normalized employee `Address→City→Region→Country` hierarchy**
(`EmployeeAddress` + `LocationCascadePicker`). That is a heavyweight reference-data graph for
per-employee postal addresses with DB-backed search/create. `Organization.address` is the
canonical denormalized identity blob per §11, and the BI is explicit: *do not add a parallel
address field elsewhere*. The org address lives in `Organization.address`.

## UX-Fit decision (AGENTS.md §12, enforced)

New input control → UX-Fit gate applies. Scored on `human_cognitive_load` via `principle_decide`
(population `external_coding_agent`, surface `ux-fit-gate`):

| Option | Composite | Verdict |
| --- | --- | --- |
| **structured-address-derive-confirm** | **−0.134** | **Recommended (high, margin 0.312)** |
| freetext-address-parse | −0.445 | rejected |
| ask-timezone-directly | −0.757 | rejected (the §12 anti-pattern) |

**Chosen:** capture a structured address — **country dropdown**, and **only when country = US**
a **US-state dropdown** (progressive disclosure), plus plain street/city/postal text. Auto-derive
the IANA timezone and show it **read-only**; the operator confirms/overrides in the existing
Operating Hours picker. We never ask a layman to type a timezone. Recorded as a
`UX-Fit-Decision:` trailer on the PR.

## Design

### 1. Canonical `OrgAddress` shape + helpers (new, pure module)

`apps/web/lib/shared/org-address.ts` — dependency-light (pure data + functions, no Prisma), so
the unattended cron path can import it like `timezone-from-location.ts`:

```ts
export type OrgAddress = {
  line1?: string; line2?: string; city?: string;
  region?: string;       // state/province DISPLAY name (e.g. "Illinois") — readers use this
  postalCode?: string;
  country?: string;      // country DISPLAY name (e.g. "United States")
  stateCode?: string;    // normalized US 2-letter (e.g. "IL") — drives precise timezone
  countryCode?: string;  // ISO 3166-1 alpha-2 (e.g. "US") — drives country-fallback timezone
};
```

- `US_STATES: { code, name }[]` — 50 + DC + the five territories. Codes MUST match
  `US_STATE_TO_TIMEZONE` (a vitest guard asserts coverage both ways).
- `COUNTRY_OPTIONS: { code, name }[]` — the countries `COUNTRY_TO_TIMEZONE` can resolve, common
  ones first. The form also offers "Other / not listed" → free-text country (no derived tz, the
  picker covers it). Keeps the dropdown short and honest rather than a 250-row ISO list.
- `parseOrgAddress(json): OrgAddress` — tolerant read: `line1 || street`, `postalCode || postcode
  || zip`, `region || state`; understands the legacy `{ location }` blob (kept as a display line);
  ignores unknown keys.
- `serializeOrgAddress(addr, existingJson?): Record<string, unknown>` — **non-destructive merge**
  onto the existing JSON (preserves `latitude/longitude` and any legacy keys), writes canonical
  keys plus `street`(=line1) and `postcode`(=postalCode) **compat mirrors** so the
  `StorefrontAddress`/storefront-data reader keeps working with zero reader edits.
- `formatOrgAddressLines(json): string[]` — single display formatter; `org-identity.ts` delegates
  to it so there's one source of truth for address display.
- `orgAddressTimezoneSignal(addr): { stateCode, countryCode }` — pulls the normalized codes for
  derivation.

### 2. Address → precise timezone

- `timezone-from-location.ts`: add `resolveTimezoneFromAddress(addr: OrgAddress): string | null`
  = `resolveTimezoneFromLocation(orgAddressTimezoneSignal(addr))`. (The task's "extend
  `resolveTimezoneFromLocation`" — the core resolver already handles US-state precision; this is
  the address-shaped entry point.)
- `operating-hours-read.ts deriveTimezoneFromBusinessLocation`: read `Organization.address`
  first → `resolveTimezoneFromAddress` (precise); **fall back** to the existing
  `BusinessContext.stateCode` / `operatesIn` path so installs with no address yet keep today's
  behaviour (no regression). Stays fail-open (try/catch → null).

### 3. Capture UI + persistence

- `BusinessContextForm.tsx`: a compact **Business address** block — Country `<select>`
  (`COUNTRY_OPTIONS` + Other), conditional US-State `<select>` (`US_STATES`) when country = US
  else a free-text region input, and `line1` / `line2` / `city` / `postalCode` text inputs.
  A read-only "Detected timezone: `America/Chicago` — confirm or change under Operating Hours"
  hint, computed client-side via `resolveTimezoneFromAddress` (pure import). Theme tokens only
  (`var(--dpf-*)`), `<option>` gets `bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]` per §12.
- `api/business-context/setup/route.ts`: accept `address`, validate/normalize via
  `serializeOrgAddress` (merge onto current `Organization.address`), write it; when a US
  `stateCode` is present also set `BusinessContext.stateCode`. GET returns the parsed address.
- `business/page.tsx`: pass `initial.address = parseOrgAddress(org.address)`.
- `org-identity.ts`: `formatAddress` → delegate to `formatOrgAddressLines` (single source).

## Research & Benchmarking

- **Stripe / Shopify business-profile capture**: structured address with a country select that
  *reveals* a region/state select for countries with subdivisions (US/CA/AU). Adopted: the
  country-gates-state progressive pattern. Rejected: full live address autocomplete/geocoding —
  out of scope (no geocoding MCP configured; `validateAddress` already returns `no-service`).
- **IANA tz from location**: state-level mapping is the standard pragmatic default (vs a ZIP→tz
  table or a lat/lng tz-shape lookup). Per-address sub-state precision stays out of scope
  (the Operating Hours picker covers split-zone minority cases), consistent with the #2201 plan.

## Verification

- **Unit:** `org-address.test.ts` (parse aliases + legacy `{location}`; non-destructive
  serialize preserving lat/lng; US_STATES↔US_STATE_TO_TIMEZONE coverage guard; tz-signal
  extraction). Extend `timezone-from-location.test.ts` for `resolveTimezoneFromAddress`. New
  `operating-hours-read.test.ts`: address-state beats country fallback; falls back to
  `BusinessContext` when no address; fail-open on throw.
- **Build gate:** typecheck + `pnpm --filter web build` via the shared local-CI sandbox or
  canonical install (a source-only worktree cannot run the production build); existing
  `operating-hours.test.ts` stays green (derive is fail-open under its prisma mock).
- **UX:** address block on `/storefront/settings/business`, derived-tz hint updates on
  country/state change, Operating Hours shows the state-accurate default for confirmation.

## Out of scope

- Geocoding / lat-lng capture (preserved if already present; not collected here).
- Migrating the account-setup wizard's legacy `{ location }` write (left readable via the
  tolerant parser; business-context is the canonical capture home for this BI).
- Per-address sub-state timezone precision (picker covers exceptions).
- Full ISO-3166 country list (curated tz-resolvable set + Other).
