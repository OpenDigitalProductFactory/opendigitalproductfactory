# Contextual Docs quick-help panel (BI-2DD18122)

## Problem

Opening the contextual **Docs** link from a working screen currently lands the
operator on a generic docs page (or the ~80-link catalog) with a small "Opened
from `<route>`" banner. That reduces overload only marginally: the reader still
has to find, in a manual, the answer to the immediate question they had on the
page they left. On high-consequence routes (`/ops/self-upgrade`) it is actively
misleading, because the route falls through to the generic operations backlog
doc.

## Approach

Lead the contextual docs surface with a short, route-specific **quick-help
panel** that answers the five questions a stuck operator actually has, then keep
the full doc body underneath and demote the catalog.

### Source of truth

- `apps/web/lib/docs-route-map.ts` — the existing `sourceRoute` → `docsPath`
  registry (longest-prefix match). Extended with an explicit
  `/ops/self-upgrade` → `/docs/operations/self-upgrade` entry so self-upgrade no
  longer falls through to `/docs/operations/index`.
- `apps/web/lib/docs-quick-help.ts` — **new** data-only registry keyed by the
  `sourceRoute`, resolved by longest matching prefix. Keyed by route (not doc)
  so routes that legitimately share one long-form doc (e.g.
  `/storefront/settings/business` and `/storefront/settings/operations`) can
  each show route-specific guidance.

### The five questions each panel answers

1. What this page is
2. What action to take now
3. What happens if nothing is done
4. What is reversible
5. Where recovery / help lives

### Rendering

- `apps/web/components/docs/ContextualQuickHelp.tsx` — **new** server component.
  Keeps the `sourceRoute` provenance and the **Back to page** affordance, and
  renders the quick-help panel above the doc body when the route has help.
- `apps/web/app/(shell)/docs/[[...slug]]/page.tsx` — renders `ContextualQuickHelp`
  in place of the old inline banner; when arriving contextually, collapses the
  home catalog into a `<details>` disclosure.
- `apps/web/components/docs/DocsLayout.tsx` + `DocsSidebar.tsx` — accept a
  `collapseCatalog` / `collapsible` flag that demotes the full area list into a
  collapsed disclosure so it does not compete with the immediate explanation.

### Docs

- `docs/user-guide/operations/self-upgrade.md` — **new** dedicated user-guide
  page for `/ops/self-upgrade`, so the mapped `docsPath` is backed by a real
  page and the full doc body is self-upgrade-specific.

## Tests

- `apps/web/lib/docs-quick-help.test.ts` — `resolveQuickHelp` for the required
  routes (`/storefront/inbox`, `/storefront/settings/business`,
  `/ops/self-upgrade`, `/customer/marketing`), longest-prefix specificity,
  misses, and `buildContextualDocsHref` preserving `sourceRoute`.
- `apps/web/components/docs/ContextualQuickHelp.test.tsx` — contextual banner
  rendering (Back to page + sourceRoute) and the five-question panel.

## Non-goals / coordination

- The archetype-vocabulary storefront panel explored on
  `claude/storefront-docs-help-panel-2d417c` is a separate, storefront-only take;
  this slice is the general route-keyed quick-help system that also covers
  `/ops/self-upgrade` and `/customer/marketing`.
