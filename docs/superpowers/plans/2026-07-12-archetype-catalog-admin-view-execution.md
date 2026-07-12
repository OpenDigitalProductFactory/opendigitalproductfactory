# Archetype Catalog admin view — execution plan

**Parent:** [2026-07-12-operational-twin-framework-execution.md](2026-07-12-operational-twin-framework-execution.md)
**Design:** [2026-07-12-operational-twin-framework-design.md](../specs/2026-07-12-operational-twin-framework-design.md), [2026-07-11-living-business-workforce-visualization-design.md](../specs/2026-07-11-living-business-workforce-visualization-design.md)
**Epic:** EP-LIVING-BUSINESS-VIZ
**Started:** 2026-07-12

## Problem

There is no in-product surface that lists the archetype configurations a business
has **not** enabled. The setup wizard (`/storefront/setup`) is the only page that
renders the full catalog, and its first line redirects away the moment a
`StorefrontConfig` exists (`if (existing) redirect("/storefront")`) — so once a
business is live, the ~94 seeded configurations become invisible. An operator
asking "what else could this business have been / what does each configuration
imply?" has nowhere to look. This is an **administrative** concern: the archetype
is the org's industry SSOT (`StorefrontConfig.archetypeId`) and, through it, drives
the operational twin, vocabulary, playbook, and value stream — it "affects the
entire business."

## Decision

A read-only **Archetype Catalog** at `/admin/archetypes`, in the admin
**Configuration** family (alongside Business Models, Reference Data, Data
Stewardship) — the family for "global settings, reference data, operating rules."
It is a *catalog/reference* surface, not an activation control: switching the live
archetype stays the setup/onboarding flow's job. Read-only keeps the blast radius
of a whole-business setting off a general admin table.

## Shape

- **`apps/web/app/(shell)/admin/archetypes/page.tsx`** (server) — queries
  `storefrontArchetype` (installed, `isActive`) for the catalog and
  `storefrontConfig.archetype.archetypeId` for the one enabled slug (the config's
  own `archetypeId` column is the cuid FK, so the slug is read through the
  relation). Each row joins to the canonical seeded definition in `ALL_ARCHETYPES`
  (full leaf overrides) and runs the merged **`deriveTwinProfile`** to surface the
  operational-twin template/variant per configuration — making this the first
  product surface to *show* the twin framework. Falls back to a definition
  synthesized from the DB row for any installed leaf with no compiled counterpart.
- **`apps/web/components/admin/ArchetypeCatalogTable.tsx`** (client) — composed
  entirely from **report-kit** primitives (`StatCard`, `FilterBar`, `DataTable`,
  `StatusBadge`) per the `compose-report-kit-for-reporting-ux` principle. Columns:
  Archetype (name + mono id), Category, CTA, Operational twin (template badge +
  variant), Status (Enabled / Available). Filters: search, Status pills, Category
  and Twin selects. Summary tiles: Configurations / Enabled / Available /
  Categories.
- **`apps/web/components/admin/admin-nav.ts`** — adds the `Archetypes` sub-item and
  match-prefix to the Configuration family.
- **`apps/web/lib/ea/route-manifest.json`** — regenerated for the new route.

## Verification

- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web check:route-manifest` — up to date after regeneration.
- `deriveTwinProfile` totality over all seeded archetypes is already covered by the
  merged `packages/storefront-templates/src/twin-profile.test.ts` (P1).

## UX-fit

Recorded as a `UX-Fit-Decision:` attestation on the PR: progressive disclosure via
a single default-sorted table (Enabled first) with optional facets, zero raw/numeric
operator inputs, all metric/status rendering delegated to report-kit rather than
bespoke tiles. See §12 of AGENTS.md.

## Not in scope

Activating/switching the archetype from this view (stays the onboarding flow),
editing configurations, and the composed-archetype (`StorefrontArchetypeComposition`)
case — deferred with the framework plan.
