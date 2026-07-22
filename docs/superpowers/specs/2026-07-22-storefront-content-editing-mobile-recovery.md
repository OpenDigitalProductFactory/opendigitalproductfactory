# Storefront menu & section editors — mobile-safe, preview-first, recoverable

- **Backlog item:** BI-CBE9B9B3 — "Storefront menu and section editors need mobile-safe preview-first recovery flows"
- **Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
- **Status:** implemented
- **Date:** 2026-07-22

## Problem

The 390×844 owner-mobile audit found `/storefront/items` (~70 actions, 69 sub-44px
controls, `Edit`×11 / `Del`×11 / `Off`×6 / `On`×5) and `/storefront/sections`
(~69 actions, `↑`/`↓`×11, `Show`×7 / `Hide`×4, raw type slugs) mobile-hostile.
These are exactly the pages a non-technical owner opens to fix bad *generated*
content — including cross-archetype residue (warehousing "Pallet Storage",
"Goods-In & Receiving", "Pick & Despatch", or a banking loan-calculator section
surfacing inside a Restaurant portal) — yet the controls were small, terse,
repeated, and their public/durable mutations fired with no preview and no
recoverable result state.

A sibling PR (#3395) already applied the 44px minimum + per-row `aria-label`s to
these managers. This item owns the deeper content-management slice the tap-target
work explicitly left out: **preview-first public mutations, per-row result state,
Restaurant vocabulary, action-count reduction, and grouped residue recovery.**

## Scope & overlap

Swept `gh pr list` (open #3387–#3407): no open PR touches `ItemsManager`,
`SectionsManager`, the `/storefront/{items,sections}` pages, or the storefront
content-fit surface. Sibling BI-C39DC90C (#3389) owns setup-page service-line
recovery; this PR is disjoint — it operates on the item/section editors and adds
a distinct *cross-archetype* residue detector (primary-seed residue that
`sourceCompositionId`-based service-line recovery does not cover).

## Design grounding

- **Specs/plans reviewed:** `docs/superpowers/specs/` EP-UX-COGLOAD set, notably
  `2026-07-22-storefront-owner-mobile-setup-design.md` (sibling setup slice).
- **Code substrate reviewed (`apps/web/`):**
  `components/storefront-admin/{ItemsManager,SectionsManager}.tsx`,
  `lib/storefront/{archetype-vocabulary,service-line-actions,archetype-reset}.ts`,
  `components/storefront/SectionRenderer.tsx`, the
  `api/storefront/admin/{items,sections}/*` routes, and the
  `StorefrontItem`/`StorefrontSection`/`StorefrontArchetype` models.
- **Source of truth:** archetype seed templates (`StorefrontArchetype.itemTemplates`
  / `sectionTemplates`) are authoritative for "what belongs"; the renderer's
  `switch (section.type)` is the closed section-type universe.
- **Decision:** new artifact (this doc) + new modules; no existing contract
  changed. No new API route (recovery is a server action), so route-manifest and
  audience baselines are untouched.

## Design

### 1. Row action sheet (action-count + hit-area)
`RowActionSheet` collapses every row's controls into **one** 44px "Manage"
trigger whose accessible name is row-specific (`Manage Table for 2`). It opens a
bottom sheet of full-sentence, row-specific actions (`Hide Table for 2 from your
public menu`, `Move Set Dinner Menu up`, `Remove Sunday Roast`). This takes the
pages from ~70 tap targets to one-per-row and removes every repeated terse label.
Reorder moves from mobile-hostile drag/drop to explicit labelled Move up/down.

### 2. Preview-first public mutations
`confirmPublicChange` previews **what** changes, **where** it shows (`your public
menu` / `your public page`), and **whether the live site is affected right now**
(keyed on `StorefrontConfig.isPublished`) before any visibility/active/remove
mutation runs. Reorder is low-stakes and gets result state without a blocking
preview.

### 3. Per-row result state + retry/revert
`useRowMutations` tracks pending → saved → failed per row; `MutationStatus`
renders it inline with a Retry that re-runs the exact action. Every mutation
applies optimistically and **reverts on failure**, replacing the previous bare
`fetch` with no feedback.

### 4. Grouped generated-residue recovery
`lib/storefront/content-fit.ts` (pure, unit-tested) classifies residue from
evidence — no schema flag exists:
- **Foreign item** — name exactly matches a *different* category's seed item
  template (and not the current category's). Exact-match keeps false-positives
  near zero; owner-typed names match no foreign template.
- **Foreign section** — an archetype-specific section type (`donate`,
  `animals-available`, `disclosures`, `calculator`) belonging to another
  category. Universal types (hero/about/items/contact/team/gallery/testimonials/
  custom) are never flagged.
- **Duplicate section** — a second-or-later singleton section (hero/about/
  contact/items).

`content-fit.server.ts` builds the fingerprint from every archetype's seed
templates. `GeneratedResidueBanner` shows the grouped, previewable recovery with
an affected-artifact list; `recoverGeneratedResidue` (server action) **re-derives
the residue set server-side** and removes only ids that are both requested and
independently classified — a stale/tampered client can never delete legitimate
content. Items with real bookings/enquiries are deactivated, not deleted,
mirroring the single-item DELETE contract.

### 5. Restaurant vocabulary, no slug leakage
Section rows show the owner's title or a friendly label (`hero` → "Welcome
banner", `items` → "Menu", `team` → "Staff") via `sectionDisplayName`; the raw
`type` slug is never rendered. Menu labels use `ArchetypeVocabulary`.

## Testing

- `lib/storefront/content-fit.test.ts` — detection: foreign items, foreign/
  duplicate sections, no false-positives on owner or shared content, grouping,
  friendly naming.
- `components/storefront-admin/mobile-content-ux.test.tsx` — the required mobile
  UX checks against the default 390px render: one labelled action per row, no
  sub-44px controls, unique (non-repeated) accessible names, no internal slug
  leakage, and recovery-surface presence only when residue exists.

## Files

- New: `lib/storefront/content-fit.ts`, `content-fit.server.ts`,
  `content-recovery-actions.ts`; `components/storefront-admin/content-editing-ui.tsx`;
  two test files; this doc.
- Changed: `components/storefront-admin/{ItemsManager,SectionsManager}.tsx`,
  `app/(shell)/storefront/{items,sections}/page.tsx`.
