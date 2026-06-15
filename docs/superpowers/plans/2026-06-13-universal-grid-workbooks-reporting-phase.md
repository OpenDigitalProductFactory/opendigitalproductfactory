# Universal Grid & Workbooks — Reporting Phase implementation plan (aggregation + reverse-references)

**Epic**: EP-GRID-WORKBOOKS
**Spec**: [2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md](../specs/2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md) (Reporting phase row of the phased build order)
**Date**: 2026-06-13
**Status**: Draft — plan only, no code yet. BI to be filed under EP-GRID-WORKBOOKS when MCP backlog tooling is reachable.

This is the phase Phase 2 **deliberately deferred**. The Phase 2 plan named the deferral
verbatim:

> *"Deferred (named so scope is clear): cross-row aggregations (SUMIFS/COUNTIFS over a
> column), rollups over one-to-many collections, and REF/LOOKUP inside formulas — all
> need the full dataset / reverse-references / push-down, so they belong with the
> reporting phase."*

Everything in Phase 2 was **per-row, local-derivation** computation (a formula/lookup sees
only its own row's cells). The reporting phase is the first time a computed cell must read
**other rows / other tables** — which is exactly why it needs new substrate, not another
column type. This plan decomposes it into single-concern PRs grounded in the current code.

## Why this is a phase, not a slice

The Smartsheet/Supabase parity gap that remains is all *aggregation across records*:

| Parity target | What it needs that doesn't exist yet |
|---|---|
| Smartsheet **rollup** (parent rolls up child values) | a reverse-reference index: given a target record, find the rows that reference it |
| Supabase **aggregate over a relation** (`count`, `sum` of related rows) | same reverse index + push-down so it's correct beyond the loaded page |
| Smartsheet **cross-sheet/cross-row** `SUMIFS`/`COUNTIFS` | dataset-aware formula functions that read a whole column, not one row |
| `REF()` / `LOOKUP()` **inside** a formula | the formula evaluator must be able to resolve references mid-expression |

The current compute path (`lib/workbooks/formula/compute.ts → computeDerivedCells`) is given a
single row's resolved cells and evaluates per row. None of the above fit that signature; they
require the evaluator to see the table (or a pushed-down aggregate of it). Building them on the
per-row path would silently produce wrong results for paginated tables — a violation of
"proper fix over quick fix" and "no silent caps."

## Substrate already in place (do not rebuild)

- **Per-row computed columns** — `formula`/`lookup` are `FieldType`s; `isComputedFieldType`
  gates read-only; `computeDerivedCells` runs the jsep-based evaluator per row
  (`lib/workbooks/formula/{evaluate,functions,compute}.ts`). The function registry and AST
  evaluator are the extension point for dataset-aware functions.
- **Forward references** — `reference` columns resolve a single target via
  `searchReferences`/`resolveReference` on the adapter, hydrated by
  `lib/workbooks/reference-resolver.ts`. The registry (`platform-tables.ts`,
  `people-supplier-configs.ts`) maps `referenceType → Prisma model + label/search fields`.
- **Generic Prisma adapter** — `generic-read-adapter.ts` already turns any allow-listed model
  into a grid with config-driven `where`/search; it is the natural home for a *count/aggregate*
  query against a related model.
- **Server read path** — `grid-query.ts` assembles rows for the grid/MCP/API; this is where a
  push-down aggregate must be injected so the value is dataset-correct, not page-correct.
- **Summary panel** — `grid-summary.ts` already does client-side group-by + sum/avg/min/max over
  *loaded* rows (W-SUMMARY). It is the UX precedent for aggregation, but is explicitly
  loaded-rows-only; the reporting phase makes the same math server-authoritative + persistable
  as a column.

## New substrate this phase introduces

1. **Reverse-reference resolution** — for a `referenceType`, given a target id, return the rows
   (in some table/model) that reference it. For platform models this is a Prisma `count`/`findMany`
   with a `where` on the FK; for custom workbook tables it is a query over `WorkbookCell` where
   `referenceId = ?`. New optional adapter methods, mirroring the forward pair:
   `countReferencing(referenceType, targetId, filter?)` and
   `aggregateReferencing(referenceType, targetId, field, op, filter?)`. Capability-gated exactly
   like `searchReferences` (no aggregate may leak rows a viewer can't see).
2. **`rollup` field type** — `FieldConfig.rollup = { referenceColumnId, targetField, op }` where
   `op ∈ count|sum|avg|min|max`. Computed read-only, `provenanceKind: "derived"`. Resolved on the
   **server** (push-down), never from loaded rows.
3. **Dataset-aware formula functions** — `SUMIF`/`SUMIFS`/`COUNTIF`/`COUNTIFS` and `REF`/`LOOKUP`
   added to the function registry, evaluated against a *column accessor* the evaluator is handed
   (an interface over the server dataset), not the per-row map. Per-row formulas keep their exact
   current behavior; only formulas using these functions trigger the dataset path.
4. **Push-down aggregate in `grid-query.ts`** — computed aggregate columns are resolved in the
   read path with a bounded number of grouped queries (one per aggregate column, not N+1 per row),
   so values are correct for the whole filtered dataset regardless of pagination.

## Slices (single-concern PRs, ordered by dependency)

1. **Reverse-reference adapter methods** — add `countReferencing` + `aggregateReferencing` to the
   adapter interface; implement for the generic Prisma adapter (platform models) and the custom
   `WorkbookCell` adapter; capability-gate. Pure data layer, unit-tested against a shadow dataset.
   No UI. *(Foundation for slices 2–3.)*
2. **`rollup` column type (count first)** — wire `rollup` through types/validation (read-only),
   `grid-query` push-down resolution, Grid render (`renderComputedCell`), and the Add-column picker
   (reuses the lookup picker's reference-column + target-field selects, adds an op select). Ship
   `count` end to end; `sum/avg/min/max` follow once `count` is proven. Tests: rollup resolves the
   right aggregate; respects filters; fails closed when the viewer lacks the target capability.
3. **Dataset-aware formula functions** — extend the evaluator with a column-accessor interface and
   add `COUNTIF(S)`/`SUMIF(S)`; keep per-row formulas on the fast path. Tests: criteria matching,
   chained against a rollup column, `#ERROR:` on malformed criteria.
4. **`REF`/`LOOKUP` inside formulas** — let the evaluator resolve a reference mid-expression via the
   resolver, so `=LOOKUP([Account], "owner")` works in a formula, not just a lookup column.
5. **(Stretch) Realtime refresh** — Supabase-style live update: when an underlying record a
   rollup/reference depends on changes, invalidate + recompute the dependent cells. Scope TBD;
   likely rides the existing revalidation path rather than a websocket in v1. Split to its own plan
   if it grows.

## Out of scope (kept explicit)

- **Lineage edges for derived columns (fail-closed)** — still owned by the governance/lifecycle
  phase per the Phase 2 plan; the reporting phase's aggregates are *local-derivation reads*, no SoR
  mutation, so the fail-closed promotion invariant is not engaged here.
- **Cross-*workbook* references** (a reference whose target is another workbook table) — possible on
  this substrate later, but not in this phase.

## Verification

Per the single-verification-path rule, functional acceptance is a new **W-ROLLUP / W-AGG** line in
the Phase W / RC27 checklist (filed with slice 2), exercised on the per-archetype portal-rebuild
audit — not on a contributor preview. Each slice still ships with its own vitest coverage and a
green `pnpm --filter web typecheck` as the PR gate.
