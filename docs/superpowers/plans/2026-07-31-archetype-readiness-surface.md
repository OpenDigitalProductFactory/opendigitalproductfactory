# Operator-Facing Archetype Readiness Surface Implementation Plan

## Backlog

- Backlog item: `BI-1A222A7A` - Operator-facing archetype readiness matrix surface
- Parent context: `BI-C1C706F1` - Archetype readiness matrix and sales-claim gate
- Epic: `EP-PLATFORM-SUBSTRATE-CONVERGENCE`
- Branch: `feat/archetype-readiness-surface`
- Backlog coverage receipt: `cms884ejf003o01qor6j6nhue`
- UX decision interaction: `DI-899975251014`

## Goal

Expose the existing archetype readiness matrix inside the Platform operator surface so claimability can be reviewed without reading package code or architecture memos. The page must derive from `ARCHETYPE_READINESS_MATRIX` and must not duplicate readiness data in app code.

## Scope

In scope:

- Add a read-only Platform Overview subpage for archetype readiness.
- Add the subpage to the Platform Overview secondary navigation.
- Render all archetype category records from `@dpf/storefront-templates`.
- Show current highest claimable tier, blocked higher tiers, and evidence references.
- Add focused render tests that prove the page/component consumes the shared matrix.
- Record UX-fit notes for the new operator-facing surface.

Out of scope:

- New readiness tiers or changed tier semantics.
- Public marketing copy.
- New Prisma models, API routes, or migrations.
- Live claim approval workflow.

## Implementation

1. Add a small server-usable component under `apps/web/components/platform/` that maps `ARCHETYPE_READINESS_MATRIX` into a compact report view.
2. Add `apps/web/app/(shell)/platform/archetype-readiness/page.tsx` using the component.
3. Add `Archetype Readiness` to the Platform Overview family in `platform-nav.ts`.
4. Add focused tests for the route/component using `renderToStaticMarkup`.
5. Add a UX-fit record under `docs/ux-fit/` describing information architecture, density, responsive behavior, and verification status.

## UX Fit

This belongs in Platform Overview, not AI Operations. The page answers "which business archetypes can we claim are ready, and what blocks higher claims?" AI readiness answers provider/runtime readiness. Keeping them separate avoids making operators infer business readiness from AI runtime health.

The page should be quiet and dense: a short header, summary KPIs, a clear caution notice, and a matrix-derived table/list. It should use report-kit primitives where they fit and avoid a marketing-style hero.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md`
  - `docs/architecture/archetype-business-value-streams.md`
  - `docs/architecture/2026-06-22-platform-adequacy-architecture-review.md`
- Current code substrate reviewed:
  - `packages/storefront-templates/src/archetype-readiness.ts`
  - `packages/storefront-templates/src/archetype-catalog.ts`
  - `apps/web/components/platform/platform-nav.ts`
  - `apps/web/components/ui/report-kit/README.md`
- Source of truth:
  - `ARCHETYPE_READINESS_MATRIX` and its evaluator in `@dpf/storefront-templates` remain the readiness data source.
  - Badge intent mapping lives in `apps/web/components/ui/report-kit/statusColors.ts`.
- Decision:
  - Expose a read-only Platform Overview subpage that consumes the shared readiness matrix and report-kit primitives; do not add route-local readiness data, status-color maps, database tables, or new claim semantics.

## Verification

Source-local:

- Targeted Vitest for the new page/component.
- Typecheck/build if the worktree is compile-ready.

Runtime-bound:

- UX verification on the governed live install or shared local-CI sandbox after the feature is deployed there.

## Backlog Coverage

Atomic plan rationale: this is one independently useful surface. Navigation, page, component, tests, and UX-fit notes are not separately shippable because a nav link without the page, a page without matrix rendering, or tests without the route would not close the operator visibility gap.
