# Storefront owner: task-first setup + recovery model

- **Backlog item:** BI-C39DC90C — "Storefront owner setup needs task-first status and recovery for generated content"
- **Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up)
- **Surface:** `apps/web/app/(shell)/storefront/` admin routes
- **Date:** 2026-07-22

## Problem (from the live audit)

A Restaurant owner's `/storefront` admin exposed many setup surfaces with no
coherent, task-first status, no map of what generated content exists, and no
safe recovery path:

- `/storefront` ~505 words / 17 actions, cross-industry/generated residue,
  `Add service line` / `Unpublish` with no preview or recovery language, and a
  **101-option** service-line `<select>` sitting in the page + accessibility
  stream.
- Removing a service line retained items/sections (deactivated/hidden) with no
  explanation and no undo — the owner could not tell what was kept or get it
  back.

## Design grounding

- **Source of truth:** the multi-archetype composition model
  (`2026-06-13-multi-archetype-composition-design.md`,
  `StorefrontArchetypeComposition` + `sourceCompositionId` provenance on items
  and sections). This change **extends** that model's UI; it introduces no new
  table, enum, or provenance concept.
- **Substrate reused:** `service-line-actions.ts` (add/remove), `composition-view.ts`,
  `archetype-vocabulary.ts` (restaurant → Menu / Tables / Reservations),
  `@dpf/validators/readability.ts` (sibling policy pattern for the new UX check),
  `report-kit/statusColors.ts` (intent tokens).
- **Decision:** keep all mutating logic in server actions + a pure model so the
  behaviour is testable without rendering; the client component is a thin shell.
  Advanced/cross-industry expansion is **collapsed until opened** (progressive
  disclosure) so the default surface stays inside the cognitive-load ceilings.

## What shipped

1. **`packages/validators/src/setup-ux.ts`** — a pure, shared route-level UX
   validator (`analyzeSetupSurface`) with ceilings for **word count**, **action
   count**, **repeated terse labels** (Edit/Del/On/Off/↑/↓ with no
   distinguishing accessible name), **long inline option exposure** (a long list
   must be collapsed-until-opened), and **generated-content recovery state**
   (every generated group must be recoverable). Mirrors `readability.ts`.
2. **`apps/web/lib/storefront/setup-model.ts`** — pure, archetype-aware
   derivation of task-first **steps** (brand · menu/items · tables/resources ·
   hours/availability · reservations/inbox) each with a plain status, a
   **generated-content inventory** grouped by the composition that produced it,
   and an **advanced** bucket kept hidden. `auditSetupSurface` holds the model to
   the ceilings.
3. **`service-line-actions.ts`** — added (additive only) `restoreStorefrontServiceLine`
   (undo of a removal), `purgeRemovedServiceLine` (permanent delete of retained
   artifacts), and `loadRemovedServiceLines`. `removeStorefrontServiceLine` /
   `addStorefrontServiceLine` are left untouched so PR #3379 (BI-7D7EE150) owns
   the add/remove confirm/preview/undo flow without collision.
4. **`StorefrontSetupPanel.tsx`** + `/storefront/page.tsx` wiring — an **additive**
   panel rendered above the existing `ServiceLinesPanel`: task-first steps with
   status, plus a **collapsed** "Generated content & recovery" disclosure that
   lists the generated inventory and offers **restore** / **remove permanently**
   for removed-but-retained lines — each with a **preview** (affected artifacts),
   **confirm**, **success/failure feedback**, and **undo** (restore) or an explicit
   "cannot be undone" warning (purge). `ServiceLinesPanel` keeps ownership of
   add/remove of active lines (BI-7D7EE150).

### Reconciliation with PR #3379 (BI-7D7EE150)

BI-7D7EE150 is an in-flight PR adding confirm/preview/undo to service-line
**add/remove**. To avoid a hard collision this PR is deliberately **additive**:
it does not delete or modify `ServiceLinesPanel`, does not change the
`add`/`remove` action signatures, and layers the task-first status + the
recovery-of-removed-lines (restore/purge) that #3379 does not cover. The
add-line preview + the "hide the cross-industry add control" acceptance points
are delivered by #3379's flow; the two PRs compose.

## Acceptance mapping

| Acceptance | Where |
| --- | --- |
| Group setup into clear steps | `setup-model.ts` `deriveStorefrontSetupModel` |
| Setup status + generated-content inventory | steps `status`, `inventory` + panel |
| Hide advanced/cross-industry until opened | collapsed "Generated content & recovery" disclosure (add control preview owned by #3379) |
| Recovery/undo for sections/items/service lines | `restoreStorefrontServiceLine` / `purgeRemovedServiceLine` / `loadRemovedServiceLines` + recovery UI |
| Preview, affected artifacts, feedback, complete undo / explain retained | `ConfirmPanel` + restore/purge return shapes (add/remove owned by #3379) |
| Route-level UX checks | `setup-ux.ts` + tests (word/action ceiling, terse labels, long-option, recovery state) |

## Follow-up (not in this PR)

- **Docs pages** mirroring the task-first steps + recovery guidance
  (operations timezone/hours effects, table-as-resource, recovering generated
  menu/items/sections). Filed separately to avoid product `doc-index` churn in
  this behaviour-focused PR; the in-product route-local recovery this BI's
  primary ask is delivered here.
- Applying the same task-first grouping to `/storefront/items` and
  `/storefront/sections` (repeated `Edit`/`Del`/`↑`/`↓` labels) — the shared
  `setup-ux` validator now gives those routes a check to build against.

## Backlog coverage

- Decision: atomic
- Parent: `BI-C39DC90C`
- Receipt: `cmrvod66y079a01rwucd9xtr5`
- Rationale: The route-level UX-ceiling validator, the pure setup model, the recovery server actions, and the StorefrontSetupPanel are one interdependent vertical slice — the panel cannot ship without the model, the model without the validator, or the recovery UI without the actions — so they ship together under BI-C39DC90C and no phase is independently shippable. The Docs-page mirror and applying the same grouping to /storefront/items and /storefront/sections are out of this plan's scope and will be filed as separate BIs (see Follow-up).
- Dependencies: none
- Task-first setup status + generated-content inventory + recovery of generated service lines -> `BI-C39DC90C`

## Verification note

This was implemented in a source-only worktree (no `node_modules`). The pure
modules were verified with vitest against the worktree source
(`setup-ux.test.ts` 13/13, `setup-model.test.ts` 8/8) and `tsc --noEmit` on the
validators package is clean. A full web `tsc` in the worktree is unreliable here
(the `@dpf/*` and `next/*` module resolution points at the main clone / sibling
worktrees), so the authoritative typecheck is CI's fresh install.
