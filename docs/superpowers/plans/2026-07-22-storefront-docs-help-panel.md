# Storefront Docs help panel (BI-2DD18122, coordinating BI-C39DC90C)

**Epic:** EP-UX-COGLOAD — Live UX cognitive-load audit follow-up
**Status:** implemented
**Scope:** the Storefront portion of BI-2DD18122 only. In-product setup/recovery UX
is BI-C39DC90C (separate worktree `restaurant-storefront-setup-recovery`).

## Problem

The owner usability audit found that contextual **Docs** links from storefront
admin routes open the full docs shell — an ~82-link area catalog and product/docs
chrome — *before* any explanation. Route pages are short (~370–630 words) yet the
catalog dominates. The `?sourceRoute=` banner only said "Opened from /storefront";
it never answered what the page is, what to do next, what a save changes, or how
to recover. Restaurant vocabulary (tables, reservations, menu, hours, guests,
availability) was absent from the sampled docs.

## Design grounding

- **Source of truth reused, not reinvented:**
  - `apps/web/lib/docs-route-map.ts` already maps storefront routes → docs pages
    and builds the `?sourceRoute=` contextual href. We key the help panel off the
    same `sourceRoute` and mirror its `docsPath` values.
  - `apps/web/lib/storefront/archetype-vocabulary.ts` (`getVocabulary`) is the
    canonical archetype vocabulary. The panel is rendered *through* it so a
    food-hospitality install reads Menu / Guests / Reservations / Staff — no new
    vocabulary source, no hardcoded "Restaurant".
- **New artifact:** a small, pure `storefront-help-panel` resolver + a
  presentational panel component. No schema, no new contract beyond the panel shape.

## What was built

1. `apps/web/lib/docs/storefront-help-panel.ts` — pure, client-safe resolver.
   `resolveStorefrontHelpPanel(sourceRoute, { vocab, archetypeCategory })` maps a
   storefront source route (dashboard, operations, business, settings, setup,
   team, items, sections, inbox; `/admin/storefront/*` mirrors normalized) to a
   panel answering the four owner questions: **what is this / what to do next /
   what changes if I save or confirm / how do I recover or undo.** Copy
   interpolates archetype vocabulary + an archetype resource noun
   (food-hospitality → *tables*), so Restaurant vocabulary is preserved without
   breaking other archetypes. Longest-prefix match; returns null off-storefront.
2. `apps/web/components/docs/StorefrontHelpPanel.tsx` — renders the panel with a
   "Back to page" affordance, above the doc content.
3. `apps/web/app/(shell)/docs/[[...slug]]/page.tsx` — for storefront source
   routes, loads the install's archetype vocabulary server-side and leads with the
   panel; collapses the catalog when a panel is present.
4. `apps/web/components/docs/DocsSidebar.tsx` + `DocsLayout.tsx` — the full area
   catalog is now collapsible and defaults to collapsed when a help panel leads
   (search stays visible). Cuts the initial ~82 nav links to a search box + one
   "Browse all areas" toggle.

## Verification

- `apps/web/lib/docs/storefront-help-panel.test.ts` — route-level coverage for the
  six required Docs links (dashboard, operations, team, catalog/items, sections,
  inbox): each resolves a four-question panel; operations explains hours/timezone
  change + recovery; team resolves the table-as-provider/staff confusion; items &
  sections give generated-content recovery; Restaurant vocabulary (tables,
  reservations, menu, hours, guests, availability) is preserved across the setup
  journey; admin mirrors + leaf routes resolve; non-food archetype adapts; every
  contextual href wires back to a panel.
- `tsc --noEmit` clean; vitest green (30 tests across the panel + route-map suites).

## Deliberately out of scope

- In-product setup status / generated-content recovery UI → **BI-C39DC90C**.
- Platform-wide docs density ceilings and the AI-workforce Advanced/Builder split
  (the non-storefront half of BI-2DD18122).
- Static user-guide markdown stays archetype-generic; the archetype-aware panel is
  the vehicle for Restaurant vocabulary and recovery guidance on storefront routes.
