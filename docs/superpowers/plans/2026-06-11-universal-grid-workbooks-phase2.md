# Universal Grid & Workbooks — Phase 2 implementation plan (relational + provenance core)

**Epic**: EP-GRID-WORKBOOKS
**Spec**: [2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md](../specs/2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md) (Phase 2 row of the phased build order)
**Date**: 2026-06-11
**Status**: Active — slice 1 in progress

Phase 2 = the relational + provenance core: reference columns over real platform
entities, rollups/lookups over those references (v1 function set), `provenanceKind`
first-class with progressive disclosure, generic Prisma adapter (shipped #1722), and
multi-step undo/redo. This plan decomposes Phase 2 into single-concern PRs grounded
in the current substrate, ordered by leverage and dependency.

## Backlog items

| BI | Concern | Slice(s) |
|---|---|---|
| BI-1F70A9AC | Reference columns + rollups/lookups (relational core) | 1, 2 |
| BI-B8549363 | `provenanceKind` + progressive disclosure | 3 |
| BI-BA57AB71 | Grid multi-step undo/redo | 4 |
| BI-29E1F452 | More read-only generic grids (customers, employees-safe, suppliers) | 5 |

## Substrate already in place (do not rebuild)

- `reference` is already a `FieldType` and `ReferenceValue` is already a `CellValue`
  member (`lib/workbooks/types.ts`). `FieldConfig.referenceType` already exists.
- The adapter interface already declares optional `searchReferences(referenceType, query)`
  and `resolveReference(referenceType, referenceId)` (`lib/workbooks/adapter.ts:64-72`) —
  **no adapter implements them yet**.
- `ReferenceTypeahead` is a finished standalone component (`components/ui/ReferenceTypeahead.tsx`,
  floating-UI, 300ms debounce, keyboard nav, async `onSearch`) — **not yet wired into the grid**.
- Reference cells already render read-only via `renderReferenceCell` (`components/workbooks/cell-editors.tsx:187`);
  `Grid.tsx` assigns no `renderEditCell` for `reference` (comment: "Phase 1: read-only until platform adapters land").
- `cell-validation.ts` already validates `ReferenceValue`.
- Add-column picker (`components/workbooks/AddColumnButton.tsx`) offers 8 types; explicitly
  excludes `reference`/`multi_select` ("reference needs platform adapters").
- `WorkbookColumn` Prisma model (`packages/db/prisma/schema.prisma`) has `fieldType` +
  `fieldConfig Json?`; **no `provenanceKind`/`lifecycleState` columns yet**.
- Formula/rollup infra is **greenfield** — no formula library in any `package.json`.

## Slice 1 — Reference columns wired to platform entities (this PR)

Goal: a user can add a `reference` column to a custom workbook table, pick which platform
entity it points at, and pick/resolve real records in the cell — end to end, read + write,
through the existing validated write path. This is the relational foundation slice 2 builds on.

1. **Reference-target registry** (`lib/workbooks/platform-tables.ts` or a small
   `reference-targets.ts`): expose the list of registered adapters that can be referenced
   (entityType + human label + the entity's display field), derived from the existing
   `PLATFORM_TABLES`/`gridRegistry` so adding a target stays one row. Read-only generic
   adapters (epic, digital_product) and the editable ones (backlog_item, invoice,
   risk_assessment) are all valid targets.
2. **Adapter `searchReferences` + `resolveReference`**: implement once in
   `generic-read-adapter.ts` (it already holds the Prisma model + label-field config — search
   by `contains` on the label field, resolve by id→label). Add thin implementations to
   `backlog-adapter.ts` and `invoice-adapter.ts`/`risk-adapter.ts` reusing the same helper, OR
   register them through the generic mechanism so one implementation covers all. Prefer the
   single shared helper to avoid per-adapter drift.
3. **Server action proxy** (`lib/actions/workbooks.ts`): `searchReferencesAction(referenceType,
   query)` and `resolveReferenceAction(referenceType, id)` → `gridRegistry.get(referenceType)?.…`,
   gated by the same session auth as the grid (and the target's own view capability — a
   reference search must not leak rows the viewer cannot see; capability check before query).
4. **Add-column UI** (`AddColumnButton.tsx`): add `reference` to the offered types; when chosen,
   show a target-entity `<select>` populated from the reference-target registry; persist
   `fieldConfig.referenceType`.
5. **Grid edit wiring** (`Grid.tsx` + `cell-editors.tsx`): add `makeReferenceEditor` that mounts
   `ReferenceTypeahead`, wiring `onSearch` → `searchReferencesAction`; on select, persist a
   `ReferenceValue { referenceId, referenceType, label }` through the existing `persistCell`
   path (custom-table-adapter write + optimistic revert on error from #1634).
6. **Label resolution on read**: when `queryRows` returns reference cells, resolve labels (store
   label in the cell value on write so reads are cheap; fall back to `resolveReference` if absent).

**Acceptance (functional, per structural≠functional)**: add a reference column on a custom
table pointing at Epics; the cell typeahead searches live epics; selecting one persists and the
grid shows the epic's title; reload still shows the label; a viewer lacking the target's view
capability gets no results (no leak). Validate by driving it on the live install after deploy.

**Tests**: unit-test the reference-target registry derivation, `searchReferences`/`resolveReference`
on the generic adapter (against a seeded model), and the action's capability gate; component-level
test that the add-column picker persists `referenceType` and the grid mounts the editor for
`reference` columns.

## Slice 2 — Lookups + formulas (computed columns) — SHIPPED

**Library decision (resolved):** `jsep` (MIT, ~5KB, already in the lockfile) to parse + a
purpose-built AST evaluator with a closed function allow-list (`formula/functions.ts`). Rejected
HyperFormula (GPL/heavy) and formulajs (still needs a parser; less control). No `eval`/`new
Function`, no member access — a user formula can never run arbitrary code.

Delivered:
- **`lookup` columns** — pull an allow-listed field from a referenced platform record
  (`formula/compute.ts` via `reference-resolver.fetchReferenceRecords`). Builds directly on slice-1
  references; can only read fields the target adapter already exposes (security preserved).
- **`formula` columns** — Excel-style row-local expressions over other columns (`formula/evaluate.ts`),
  v1 function set: IF/IFS/AND/OR/NOT/SWITCH, SUM/AVERAGE/MIN/MAX/COUNT/ROUND/FLOOR/CEILING/ABS,
  CONCAT/TEXT/LEFT/RIGHT/MID/LEN/TRIM/SUBSTITUTE/LOWER/UPPER, TODAY/NOW/YEAR/MONTH/DAY/DATEDIF/EOMONTH.
  Excel `=`/`<>`/`&` normalized; `[Column Name]` refs; formulas can reference earlier computed columns.
- Computed columns are read-only (`isComputedFieldType`), never stored, derived on read for grid+MCP+API;
  broken formulas render a `#ERROR:` sentinel, never crash a load. AddColumnButton gains Formula +
  Lookup pickers (lookup target fields via `getReferenceTargetFieldsAction`).

**Deferred (named so scope is clear):** cross-row aggregations (SUMIFS/COUNTIFS over a *column*),
rollups over one-to-many collections, and REF/LOOKUP *inside* formulas — all need the full dataset /
reverse-references / push-down, so they belong with the reporting phase. **Lineage edges for derived
columns (fail-closed)** are NOT yet written — tracked for the governance/lifecycle phase (slice 5+);
v1 computed columns are local-derivation only, no SoR mutation, so the fail-closed lineage invariant
(which guards *promotion*) is not yet engaged.

## Slice 3 — `provenanceKind` + progressive disclosure — SHIPPED (BI-B8549363)

**No migration** — provenance is *derived*, not stored: platform/generic adapters report `system`;
custom columns are `derived` (formula/lookup) or `manual` (everything else) via
`customColumnProvenance`. Avoids the deploy-gap entirely and is the correct source of truth (a
column's tier follows from what it is, not a stored flag that could drift).

- `ColumnDefinition.provenanceKind` + `PROVENANCE_KINDS`/`PROVENANCE_LABELS` (end-user wording:
  Official / Live source / Calculated / Your note).
- Every adapter's `getColumns` tags provenance (backlog/invoice/risk/generic = system; custom = derived/manual).
- **Progressive disclosure (Dale review):** the grid reads as an ordinary spreadsheet; a "Show data
  sources" toggle reveals a small per-column provenance label in the header. Hidden by default.

`source` (live external feeds) stays unused until Phase 6 integrations land.

## Slice 4 — Multi-step undo/redo — SHIPPED (BI-BA57AB71)

Undo/redo for cell edits in the `<Grid>`. Each inverse replays through the **same validated
dispatch** as a normal edit (never a raw write); a rejected inverse shows the error and leaves the
cell unchanged (persistCell's optimistic revert, parity with #1634). Ctrl-Z / Ctrl-Y (+ Ctrl-Shift-Z)
and toolbar Undo/Redo buttons; the keyboard handler yields to a cell editor's own text-undo. Stack
transitions extracted to a pure, unit-tested `grid-history.ts` (record clears the redo branch;
commitUndo/commitRedo move entries; LIFO). Cell-value edits in scope; row add/delete deferred.

## Slice 5 — More read-only generic grids — SHIPPED (BI-29E1F452)

Customers (`customer_account`, view_customer), people (`employee_profile`, view_employee — safe
org-directory fields only), suppliers (`supplier`, view_finance) as read-only generic grids +
boards. Allow-lists live in `people-supplier-configs.ts` (a light, type-only-import module) and are
**unit-tested for safe omission**: the employee grid asserts no legal-name-parts/personal-contact/
comp/PII/addresses/termination; supplier omits tax/bank/address; customer omits revenue/notes/source.
They also become reference targets automatically (slice 1). Each behind its domain view capability.

## Ordering rationale

References (1) are the relational substrate rollups/lookups (2) require. `provenanceKind` (3) is
cheap and clarifies tiers but does not block 1–2. Undo/redo (4) is independent. Generic grids (5)
are low-risk config. Build 1 → 2 → 3 in order; 4 and 5 can land any time.

## Phase 3 — Spreadsheet-on-data UX (toward Smartsheet parity)

- **Slice 6 — grid quick filter — SHIPPED.** A client-side, case-insensitive substring filter
  across all columns (pure, unit-tested `grid-filter.ts`; matches reference labels too), with a
  toolbar search box + "N of M" count.
- **Slice 7 — per-column filters — SHIPPED.** A toggleable filter panel with one control per column
  (select → option dropdown, checkbox → checked/unchecked, else text), AND-combined with the quick
  filter (`applyColumnFilters`, unit-tested), with an active-count badge + Clear. Client-side over
  loaded rows; precise number/date operators + saved views are follow-ups.
- **Slice 9 — CSV export — SHIPPED.** An "Export CSV" toolbar button downloads the current view
  (filtered + sorted) as RFC-4180-ish CSV (pure, unit-tested `grid-csv.ts`; reuses `cellSearchText`
  so exported values match what's shown, including reference labels). Works for every grid.
- **Slice 10 — conditional formatting — SHIPPED.** A "Format" panel of rules (column + operator
  [equals/contains/gt/lt/empty/…] + value + colour); the first matching rule tints the row.
  Pure, unit-tested `grid-conditional-format.ts` (`ruleMatches`/`rowColor`); applied via
  react-data-grid `rowClass`. Session-scoped for now; persisting rules to `WorkbookView` is a follow-up.
- **Slice 11 — group-by summary — SHIPPED.** A "Summary" panel groups the (filtered) rows by a
  chosen column and shows count + numeric aggregates (sum/avg/min/max) of a chosen value column per
  group. Pure, unit-tested `grid-summary.ts` (`summarize`/`toSummaryNumber`). Over loaded rows; full
  pivots (multi-dimension, subtotals, %) + SQL push-down are later Phase-4 work.
- **Slice 13 — summary chart — SHIPPED.** A Table/Chart toggle in the Summary panel renders a CSS
  bar chart of the grouped metric (count, or the value column's sum), scaled to the largest bar.
  Pure, unit-tested `summaryChartBars`. Richer chart types (pie/line via recharts) are a follow-up.
- **Slice 14 — persistent grid views — SHIPPED.** The per-grid view (quick filter, column filters,
  sort, conditional-format rules, provenance toggle) is saved per tableId and restored on reload.
  Client-side localStorage (works for every grid, no migration); pure, unit-tested `grid-view-state.ts`
  with defensive parsing (malformed/old payloads ignored field-by-field). Named/shareable server-side
  views (WorkbookView) are a follow-up.
- **Slice 15 — gallery (card) view — SHIPPED.** A Grid/Gallery toggle on the WorkbookGrid renders
  rows as cards (one card per row, each column as a label/value pair), honoring the active filters,
  sort, and conditional-format colour (a left-border accent). No new dependency, like the kanban board.
- **Slice 16 — drag-to-reorder columns — SHIPPED (BI-FFBDE996).** Every WorkbookGrid header is
  `draggable`; dropping one onto another fires react-data-grid's `onColumnsReorder`, which updates a
  saved `columnOrder` (column ids) applied through the pure, unit-tested `applyColumnOrder`
  (`grid-reorder-group.ts`): new columns append, deleted ids drop — a column is never lost or
  duplicated. `columnOrder` persists in the per-tableId view state (localStorage, no migration), so
  it works for every custom + platform grid.
- **Slice 17 — in-grid collapsible row grouping — SHIPPED (BI-198281FC).** A "Group" toolbar panel
  (progressive disclosure, parallel to Summary) with a single "Group by [column]" select renders the
  grid via react-data-grid's `TreeDataGrid` (`groupBy` + `rowGrouper` + `expandedGroupIds`). Distinct
  from the Summary panel: Summary *aggregates* a group-by into a separate table/chart; this collapses
  the *rows themselves* into groups (the Smartsheet affordance). Groups start expanded; user collapses
  are remembered as a subtraction (`collapsedGroups`) so new groups from edits/filtering still open by
  default. Grid-only (gallery stays flat); the group-by column persists in the view state. Bucketing
  is the pure, unit-tested `groupRowsByColumn`. **Multi-level grouping** is a documented follow-up —
  `groupBy` is already an array end-to-end and `TreeDataGrid` supports nesting; only the panel UI
  (add/remove ordered group levels) and expand-id handling for nested ids remain.
- **Slice 18 — table ergonomics: hide fields + frozen columns + row height — SHIPPED.** A "Columns"
  toolbar panel (progressive disclosure) with per-field show/hide checkboxes, a "Freeze first N
  columns" selector (pins the leftmost visible columns on horizontal scroll via react-data-grid
  `frozen`), and a short/medium/tall row-density toggle (`rowHeight`). Hidden fields drop out of the
  grid, gallery, and CSV export together. All three persist in the per-tableId view state. Pure,
  unit-tested `grid-view-options.ts` (`visibleColumns`/`clampFrozenCount`/`rowHeightPx`; freeze is
  clamped to leave one column scrollable).
- **Remaining (not built):** column footer summary bar (per-column aggregations); rich filter
  operators + AND/OR builder; row-expand record modal; more field types (rating/percent/currency/
  progress/duration/phone); multi-level (nested) grouping UI + inline group subtotals; named/
  shareable server-side views; calendar view (fullcalendar — needs a date column); manual row
  reordering; full pivots + richer charts; metrics/semantic layer; operationalization lifecycle.
  **Debt:** `Grid.tsx` is over the 1000-LOC hard cap — decompose the toolbar/panels into
  subcomponents before the next feature increment.

## Remaining toward full Smartsheet + Supabase parity (tracked, not built)

- **Supabase tier — SHIPPED (slice 8).** Editable generic adapter (validated raw-write tier,
  operator-approved 2026-06-12): a config opts in via `editableFields` (allow-list); the generic
  adapter writes via Prisma but only to those fields and only after the same `validateCell` the rest
  of the platform uses (`genericUpdateData`, pure + unit-tested, fail-closed on id/non-allow-listed/
  invalid). Capability-gated; the existing `updatePlatformCellsAction` path wires it in with no new
  UI. Proven on `supplier` (safe fields editable; tax/bank/address excluded by omission so
  unwritable). Customer/employee stay read-only (no manage_* capability exists yet). Adding more
  editable models is one `editableFields` line + a real `manageCapability`.
- **Reporting (Phase 4):** group-by/pivots, charts/dashboards via report-kit, drill-through,
  scheduled refresh, RLS pre-aggregation, push-down/materialization, cross-row aggregation functions.
- **Semantic layer (Phase 4):** `WorkbookMetric` (unique/owned/versioned, lineage-required).
- **Operationalization lifecycle (Phase 5):** promote column → metric → schema field / page-visual,
  with gates + blast-radius + governed retirement; derived-column lineage edges (fail-closed).
