# Storefront Docs help panel (BI-2DD18122, coordinating BI-C39DC90C)

**Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
**Status:** implemented, then reconciled (see "Reconciliation" below)
**Scope:** the Storefront portion of BI-2DD18122 only. In-product setup/recovery UX
is BI-C39DC90C.

## Problem

The owner usability audit found that contextual **Docs** links from storefront
admin routes open the full docs shell — an ~82-link area catalog and product/docs
chrome — *before* any explanation. Route pages are short (~370–630 words) yet the
catalog dominates. The `?sourceRoute=` banner only said "Opened from /storefront";
it never answered what the page is, what to do next, what a save changes, or how
to recover. Restaurant vocabulary (tables, reservations, menu, hours, guests,
availability) was absent from the sampled docs.

## Reconciliation (2026-07-22) — READ THIS FIRST

PR #3398 (`41bee2712`, same BI) landed the generic half of this work **in
parallel**: `apps/web/lib/docs-quick-help.ts` (route-keyed registry, longest-prefix
on `sourceRoute`), `apps/web/components/docs/ContextualQuickHelp.tsx`, and the
catalog demotion in `DocsLayout` / `DocsSidebar` / the docs page.

PR #3417 (this plan's original implementation) was built concurrently and shipped a
**second, parallel** mechanism — `lib/docs/storefront-help-panel.ts` +
`components/docs/StorefrontHelpPanel.tsx`. Both merged, leaving two competing help
systems in the docs shell.

The follow-up PR **deletes the duplicate** and folds its genuinely-additive value
into #3398's registry, which is now the single source of truth:

- `QuickHelp` gains an optional `whatChangesIfYouSave` — #3398's five questions did
  not cover it, and the BI names it explicitly for setup screens.
- Storefront entries become **archetype-vocabulary builders** — rendered through
  the canonical `lib/storefront/archetype-vocabulary`, so a Restaurant reads
  *menu / tables / reservations / guests / staff*. Nothing hardcodes an archetype;
  a `RESOURCE_NOUN` map supplies the bookable-resource noun per category.
- Three missing routes added: `/storefront` (dashboard), `/storefront/settings/operations`
  (the hours/timezone screen the BI calls out by name), and `/storefront/sections`.
- `/admin/storefront/*` mirrors normalize onto `/storefront/*`.
- `resolveQuickHelp(sourceRoute, ctx?)` stays backward-compatible: without `ctx` the
  builders render with default vocabulary, so existing client call sites are unchanged.
  The docs page resolves vocabulary server-side (needs the DB) and injects it.

**Lesson:** sweep `gh pr list --search "<BI-ID>" --state all` *before* building, not
just before pushing. Two PRs against one BI number is the recurring failure here.

## Verification

- `apps/web/lib/docs-quick-help-storefront.test.ts` — route-level coverage for the six
  required Docs links (dashboard, operations, team, catalog/items, sections, inbox):
  each answers what-is / next / what-changes / reversible / recovery; each route's
  guidance is distinct; operations explains hours/timezone change + recovery; team
  resolves the table-as-provider/staff confusion; items & sections give
  generated-content recovery; Restaurant vocabulary preserved across the setup
  journey; admin mirrors + leaf routes resolve; non-food archetypes adapt; the
  no-context call path still works.
- `apps/web/lib/docs-quick-help.test.ts` — updated: `/storefront/settings/operations`
  now has its own entry, so the longest-prefix fallback case uses a genuinely
  unlisted sibling (`/storefront/settings/capabilities`). The word-ceiling test now
  counts the sixth field, so adding a row cannot quietly restore a wall of text.
- `tsc --noEmit` clean; vitest green (30 tests across the quick-help, storefront, and
  ContextualQuickHelp suites, including #3398's originals unchanged in intent).

## Deliberately out of scope

- In-product setup status / generated-content recovery UI → **BI-C39DC90C**.
- Platform-wide docs density ceilings and the AI-workforce Advanced/Builder split
  (the non-storefront half of BI-2DD18122).
- Static user-guide markdown stays archetype-generic; the archetype-aware quick-help
  entry is the vehicle for Restaurant vocabulary and recovery guidance.
