# Owner-admin storefront: mobile tap-safety + outcome labels (EP-UX-COGLOAD)

- **Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
- **Primary item:** BI-F0B389C9 (Storefront owner mobile setup — tap-safe responsive controls)
- **Cross-checked acceptance:** BI-7D7EE150, BI-C39DC90C (row-specific mutation labels), BI-8E74C749 (owner-outcome field labels)
- **Source of truth:** EP-UX-COGLOAD backlog acceptance criteria.
- **Date:** 2026-07-22

## Scope (deliberately narrow — coordinated with sibling PRs)

The 390px owner-mobile audit spans many surfaces; this epic is being landed as
several non-overlapping PRs. This PR covers **only** the owner-**admin** storefront
controls that no sibling PR touches:

- `components/storefront-admin/ItemsManager.tsx`
- `components/storefront-admin/SectionsManager.tsx`
- `components/admin/OperatingHoursEditor.tsx`

Explicitly **out of scope here** (owned by concurrent PRs, to avoid conflicts):

- Mobile shell / primary-nav collapse + `globals.css` + usability-standards →
  **#3392** (shell owner-chrome action-result contract).
- `/ops/self-upgrade` owner-readable release card (BI-8D87084D) → **#3391**.
- `StorefrontInbox` booking confirm/cancel handoff (BI-3DA1DFDC) → **#3387**.
- Service-line add/remove recovery + `/storefront` setup model (BI-C39DC90C) → **#3389**.
- Public restaurant storefront 390px (BI-2B2FCB2B) → **#3390**.

## Changes

1. **Tap-safe controls (WCAG 2.5.8, 44px).** Every mutation/reorder/toggle control in
   the items and sections managers, and the operating-hours day toggle, presents a
   44×44 hit area (inline `min-h-[44px] min-w-[44px] inline-flex …`); the item Add
   button and category filter chips get a 44px min height. Rows wrap (`flex-wrap`)
   instead of overflowing at 390px.
2. **Row-specific accessible labels.** Terse repeated controls carry a row-specific
   `aria-label` naming their target: `Show/Hide <item> on your public page`,
   `Edit <item>`, `Delete <item>`, `Move <section> up/down`,
   `Hide/Show <section> section …`. Visible glyphs stay compact.
3. **Owner-outcome field labels (operations).** Each time input is labelled
   `Monday opens` / `Monday closes` with a stable `name`; the timezone select is
   labelled by outcome (`Business timezone — bookings and the maintenance window use
   this zone`); the day rows wrap so `/storefront/settings/operations` no longer
   overflows horizontally at 390px.

No new shared CSS/util files, no route-ownership change — the tap-target utilities
are applied inline so this PR shares no file with the shell/standards PR (#3392).

## Verification

- `components/admin/OperatingHoursEditor.test.tsx` — updated for the outcome label.
- `e2e/ux-owner-mobile-cognitive-load.spec.ts` — 390px assertions for operations
  field labels + no-overflow, and sections/items 44px hit areas + row labels.
- vitest green for the touched components; project typecheck via CI.
