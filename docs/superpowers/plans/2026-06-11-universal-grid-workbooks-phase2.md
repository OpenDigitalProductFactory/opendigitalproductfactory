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
  is the pure, unit-tested `groupRowsByColumn`.
- **Slice 22 — multi-level (nested) grouping — SHIPPED.** The Group panel now takes an ordered list
  of group-by columns (chips per level, outer→inner, each removable, plus an "add level…" picker)
  instead of a single select — the Smartsheet/Airtable "group by A then B" affordance. `groupBy` was
  already a `string[]` end-to-end and `TreeDataGrid` nests natively, so this is a panel-UI change plus
  a corrected expansion model: top-level groups open by default (collapses tracked in `collapsedGroups`),
  deeper levels closed by default (opens tracked in `extraExpanded`), reconciled against the current
  top-level ids each render so newly-appeared groups still open. The two intents are split back out of
  the full expanded set `TreeDataGrid` reports on each toggle, which is what makes nested expansions
  persist (the old single-level "subtraction" model dropped them). Pure, unit-tested `expandedGroupSet`
  / `splitExpandedGroupIds` (`grid-reorder-group.ts`).
- **Slice 23 — inline per-group subtotals — SHIPPED.** When grouping is active, each non-group-by
  column with a chosen aggregate renders that aggregate over the group's rows on the group header row
  (react-data-grid `Column.renderGroupCell` → `props.childRows`). It reuses the **same** `footerAgg`
  selection that drives the footer bar, so one summary function reads as both per-group subtotal and
  grand total — Excel/Smartsheet behavior — with no new config, state, or persistence. Group-by columns
  are left untouched so `TreeDataGrid` keeps rendering their toggle + value + child count. Reuses the
  pure, unit-tested `computeFooter` (`grid-footer-summary.ts`). This closes the grouping-parity
  follow-up noted in Slice 22. **UX fix (2026-07):** the per-column subtotal aggregate is now picked
  from a "Subtotals" row **inside the Group panel** (not only the footer bar, which `TreeDataGrid`
  hides while grouped) — so the aggregate is always reachable while grouping, and the earlier
  "use the Summary bar" tip is no longer a dead end. Both surfaces drive the same `footerAgg` state.
  **UX declutter (2026-07, operator feedback "the UX is not easy"):** that Subtotals row rendered a
  dropdown for *every* column (~15 on the backlog grid — overwhelming). It now shows only the *active*
  subtotals as compact chips (column + inline aggregate + remove) plus a single "+ add subtotal…"
  picker — progressive disclosure, one control by default instead of fifteen.
- **Slice 18 — table ergonomics: hide fields + frozen columns + row height — SHIPPED.** A "Columns"
  toolbar panel (progressive disclosure) with per-field show/hide checkboxes, a "Freeze first N
  columns" selector (pins the leftmost visible columns on horizontal scroll via react-data-grid
  `frozen`), and a short/medium/tall row-density toggle (`rowHeight`). Hidden fields drop out of the
  grid, gallery, and CSV export together. All three persist in the per-tableId view state. Pure,
  unit-tested `grid-view-options.ts` (`visibleColumns`/`clampFrozenCount`/`rowHeightPx`; freeze is
  clamped to leave one column scrollable).
- **Slice 19 — column footer summary bar — SHIPPED.** A per-column aggregate bar pinned to the
  bottom of the grid (react-data-grid `bottomSummaryRows` + `renderSummaryCell`), gated by a
  "Summary bar" toggle in the Columns panel. Each footer cell is an aggregate picker (count / filled
  / empty / unique for any field; sum / average / min / max for numbers) plus the value, recomputed
  over the filtered rows. Per-column selection + on/off persist in the view state. Pure, unit-tested
  `grid-footer-summary.ts` (`computeFooter`/`computeFooterRow`/`availableAggs`).
- **Slice 20 — richer field types (rating / percent / currency / progress / duration / phone) — SHIPPED.**
  Six Airtable-class field types added to `FIELD_TYPES`. Each is numeric-backed (stored as a plain
  number; `phone` as text), so validation reuses the number/text paths and editing reuses the existing
  number/text editors — no custom editor to get wrong. Only the display renderer differs: stars, `%`,
  a currency symbol, a progress bar, `Xh Ym`, a `tel:` link. Pure, unit-tested `grid-field-format.ts`.
  A shared `isNumericFieldType` (types.ts) makes the new numeric types summable everywhere (footer bar,
  group summary). Offered in the Add-column picker with sensible config defaults (5 stars, `$`, minutes);
  per-column config UI (star count, currency symbol) is a follow-up.
- **Slice 21 — structured filter builder (typed operators + AND/OR) — SHIPPED.** Replaces the
  substring-only per-column filter with a real filter builder: each condition is column + operator +
  value, where the operators offered adapt to the field type (`is`/`is not`/`contains`/`starts with`/
  `is empty` for text; `=`/`≠`/`>`/`<`/`between` for numbers/dates; `is`/`is not` for choices).
  Conditions combine with a single AND/OR toggle. Pure, unit-tested `grid-filter-builder.ts`
  (`applyFilterGroup`/`evaluateCondition`/`opsForField`); half-typed conditions never hide rows.
  Persisted as `filterGroup` in the view state (old `columnFilters` still parsed for back-compat).
- **Slice 24 — named/saved views (unified) — SHIPPED.** One "Views" dropdown on every grid: save the
  current layout under a name, apply a saved view, rename (save over), delete, and mark a default that
  auto-applies on load. A view snapshots the **full** grid view-state (`GridViewState` — filters, sort,
  grouping, formatting, column order/visibility/freeze, row height, footer aggregates), a superset of
  the spec's original `ViewConfig`, so a view restores exactly what the user saw. Two backends, one UI
  (`GridViewsMenu`): **custom tables** persist server-side to the pre-existing `WorkbookView` model
  (shared across everyone with table access, creator-attributed) via new `listViews`/`saveView`
  (upsert-by-name) / `deleteView` / `setDefaultView` service fns + `*ViewAction` server actions;
  **platform grids** persist to `localStorage` (personal), reusing the same view-state shape. Pure,
  unit-tested store ops in `grid-named-views.ts` (`upsert`/`remove`/`setDefault`/`parse` +
  `normalizeViewState`). No migration — the model already existed.
- **Slice 25 — manual row reordering — SHIPPED (custom tables).** A drag-handle column (⠿) lets the
  user drag a row into a new slot (the Smartsheet affordance). Optimistic: the local rows reorder
  immediately (pure, unit-tested `reorderRowsByDrag`, reusing the `reorderColumnIds` move algorithm),
  then the new order persists to `WorkbookRow.position` via a new `reorderRows` service + `reorderRowsAction`
  (custom tables only — `WorkbookRow.position` already exists and is what the adapter queries
  `orderBy asc`, so no migration). The handle is shown only when a manual order is actually in effect —
  custom source, editable, **no active sort and no grouping** (a sort/group defines the order and
  overrides the manual one). Platform grids (large, DB-ordered) are intentionally out of scope.
- **Slice 26 — pivot table — SHIPPED.** The Summary panel's Table/Chart toggle becomes Table/Chart/**Pivot**.
  Pivot mode crosses a **Rows** column against a **Columns** column and aggregates a value (or count) into
  a matrix with row / column / grand totals — the 2-D generalization of the group-by summary. Pure,
  unit-tested `pivot()` in `grid-pivot.ts`: incremental `{count,sum,min,max,n}` accumulators per cell /
  row / col / grand, so an `avg`/`min`/`max` **total is over the raw values, not an average-of-averages**.
  Aggregates: count / sum / average / min / max (numeric aggregates need a value column). Over the loaded
  rows (SQL push-down is later work). Reuses `toSummaryNumber`/`cellSearchText`; no contract change.
- **Slice 27 — calendar view — SHIPPED (dependency-free).** The Grid/Gallery toggle becomes
  Grid/Gallery/**Calendar** (Calendar offered only when the table has a date/datetime column). A month
  grid plots each loaded row on its day cell as a clickable chip that opens the record modal; month nav
  + which-date-column selection live in the view. **No new dependency** — the codebase carries no
  calendar/date lib, so rather than trip the New Dependency Gate with fullcalendar, the month matrix +
  day bucketing are the pure, unit-tested `grid-calendar.ts` (`monthGrid`/`bucketRowsByDay`/`cellDayKey`;
  ISO date strings are sliced, not `Date`-parsed, so a day never drifts across a timezone). Works on
  every grid (custom + platform). Grouping/sort don't apply in calendar mode.
- **Slice 28 — visual refinement (POC, operator feedback "most interaction is basic text vs refined
  graphical") — SHIPPED (calibration slice).** The grid was built functional-first on raw native
  controls; DPF already carries `lucide-react` (icons), `@floating-ui/react` (popovers) and the
  `report-kit`/`form` design kit that the grid never adopted. This POC routes it through them for one
  slice so the operator can calibrate the target polish before a full roll-out: (1) a reusable styled
  dropdown `GridSelect` (floating-ui listbox — hover/active states, selected check, keyboard nav) that
  replaces the Group panel's native `<select>`s; (2) an **icon toolbar** (lucide) with active-state
  colour on the toggles; (3) **single-cell copy/paste** (`onCellCopy`/`onCellPaste`) routed through the
  existing `onRowsChange`→`persistCell` validation. Operator approved the direction ("yes, it needs
  more conventional polish") → formalized in a spec:
  [2026-07-24-grid-visual-refinement-and-cell-interactions.md](../specs/2026-07-24-grid-visual-refinement-and-cell-interactions.md).
- **Slice 28b — visual rollout (S2 of the refinement spec) — SHIPPED.** Every remaining native
  `<select>` in the Filter / Summary / Format / Columns panels (11 in all) now uses `GridSelect`;
  column pickers carry **field-type icons** (`grid-field-icons.tsx` — # number, calendar date, list
  select, …) and the colour picker shows swatches; the view-mode toggle (grid/gallery/calendar) and the
  Views menu gain icons. `GridSelect` is more compact than a native `<select>` + `<option>` map, so
  `GridPanels.tsx` actually *shrank* (761 → 738).
- **Slice 28c — cell range selection + block copy/paste (S3 of the refinement spec) — SHIPPED.**
  Excel-grade cell interaction on the flat grid: click / Shift+click / Shift+Arrow select a rectangle
  (highlighted via `cellClass`); `Ctrl+C` copies an Excel-compatible TSV block; `Ctrl+V` fills a 1×1
  clipboard across the selection or lays a TSV block out from the selected cell (each cell through the
  validated `persistCell`); `Delete` clears a multi-cell selection. Pure, unit-tested range math in
  `grid-range.ts` (`rangeRect`/`extendFocus`/`rangeToTsv`/`parseTsv`/`pasteWrites`); react-data-grid v7
  has no native range, so it's a custom layer over its `onCellClick`/`onSelectedCellChange`/
  `onCellKeyDown`/`onCellCopy`/`onCellPaste`.
- **Slice 28d — fill + cut + select-all + fill-handle (S4) — SHIPPED.** `Ctrl+D`/`Ctrl+R` fill the
  selection down/right (pure, unit-tested `fillDownWrites`/`fillRightWrites`); `Ctrl+X` cut; `Ctrl+A`
  select-all; and react-data-grid's built-in **drag fill-handle** via `onFill`. Excel cell parity for
  the flat grid is complete. **Debt:** extract the range/fill logic into a `useCellRange` hook —
  Grid.tsx is now 1653 LOC (decomposition follow-up).
- **Remaining (not built):** manual row reordering for *platform* grids (would need a per-user client
  order; low value on 1000s of rows); platform-grid *shareable* views (needs a `WorkbookView.tableId`
  schema change — platform tables have no `WorkbookTable` row); richer charts (grouped/stacked/line);
  drag-to-create/resize on the calendar; metrics/semantic layer; operationalization lifecycle.
  **Debt (decomposition — largely paid down):** all five toolbar panels — Filter, Summary, Format,
  Group, Columns — now live as typed, presentational components in `GridPanels.tsx` (pure UI over
  props the Grid owns). This dropped `Grid.tsx` from 1298 → 1094 LOC. Remaining `Grid.tsx` bulk is the
  data / react-data-grid wiring (column builder, cell persistence, view-state, CSV, keyboard) — a
  further pass could extract the toolbar button row and the `buildColumn` factory, but the panels were
  the growth driver as each parity feature added one.

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

## Slice 22 — row-expand record detail modal — SHIPPED (BI-90971F1F)

A leading expand button on each grid row opens `RecordDetailModal` — every field on its own line for
viewing/editing. Simple types (text/url/email/phone/number + numeric-backed/checkbox/select/date)
edit inline in the modal through the **same** validated `persistCell` path (+ optimistic update + undo
history) as an in-grid edit; complex types (reference/link/attachment/formula/lookup/rollup/
multi_select) render read-only (edit in-grid). Self-contained component; `Grid.tsx` adds only an
`openRowId` state, a 36px frozen expand column, and the modal render. Escape / backdrop-click closes.
