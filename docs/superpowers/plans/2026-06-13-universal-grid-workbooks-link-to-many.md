# Universal Grid & Workbooks — link-to-many (linked records) design plan

**Epic**: EP-GRID-WORKBOOKS
**Spec**: [2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md](../specs/2026-06-07-workbooks-hybrid-systems-of-record-reporting-lifecycle-design.md)
**Date**: 2026-06-13
**Status**: Draft — plan only. **Blocked on one modeling decision** (storage shape, below) before any code, because it is a persistent schema commitment.

## The gap this closes

The reporting phase shipped per-row compute (formulas), cross-row aggregation
(COUNTIF/SUMIF/AVERAGEIF), inline REF/LOOKUP, and **platform-grid rollups**
(reverse-FK count/sum over a one-to-many that already exists in the schema). The
last Smartsheet/Supabase parity gap is the one with no existing relation to ride:

- **Airtable/Smartsheet "linked records"** — a cell that links to *many* records.
- **Custom-table rollups** — aggregating over those links (deferred from the
  reporting phase precisely because the link didn't exist).
- **Supabase many-to-many** — a join between two user tables, or a user table and a
  platform entity.

Today a `reference` cell holds exactly **one** target (`WorkbookCell.referenceId` +
`referenceType`, a single FK-like pair). Link-to-many needs *N* targets per cell.

## The decision that blocks implementation: storage shape

`WorkbookCell` is EAV with scalar columns and a `@@unique([rowId, columnId])` — one
row per cell. There are two ways to hold many targets, and the choice is a lasting
schema commitment that changes every downstream slice:

### Option A — JSON / array on the cell (no new table)
Store the links inline, e.g. a new `referenceList Json?` column on `WorkbookCell`
holding `[{referenceId, referenceType}, …]` (or reuse `multiSelectValue String[]`
for ids only).
- **Pros:** smallest migration (one nullable column); reads come back with the cell;
  no join.
- **Cons:** **cannot be aggregated in SQL** — a custom-table rollup ("sum the
  budget of all linked projects") would have to load every cell and aggregate in
  memory, which is the exact loaded-page limitation we've been careful about. No
  referential integrity; no reverse index ("which rows link to record X"); filtering
  "contains link to X" is a JSON scan.

### Option B — dedicated join table `WorkbookCellLink` (recommended)
One row per link: `{ id, rowId, columnId, referenceId, referenceType, position }`,
indexed on `(columnId, referenceId)` and `(rowId, columnId)`.
- **Pros:** links are **first-class rows** → `groupBy`/`count`/`sum` push-down works
  (custom-table rollups become the same `resolveRollups` shape we already shipped,
  just sourced from this table); reverse lookups and "contains X" filters are
  indexed; ordering via `position`; integrity is enforceable.
- **Cons:** a real migration (new model + relation on `WorkbookRow`/`WorkbookColumn`);
  cell read path must left-join/batch-load links; more code.

**Recommendation: Option B.** The whole point of link-to-many here is to *aggregate
over the links* (custom-table rollups, the gap we're closing). Option A makes that
aggregation a memory scan — re-introducing the very limitation rollups were built to
avoid — so the join table is the architecturally correct substrate. This needs
operator sign-off because it adds a table + migration (persistent, not a code-only
change).

## Slices (assuming Option B; single-concern PRs)

1. **Schema + migration** — add `WorkbookCellLink` and relations; no behavior yet.
   (DB change — explicit go required.)
2. **`linkToMany` field type + storage** — validate/store/read N links through the
   cell write path (a `LinkValue[]` CellValue member), keyed off the join table.
3. **Multi-reference editor** — extend `ReferenceTypeahead` to multi-select (add /
   remove chips), capability-gated like single reference.
4. **Custom-table rollups over links** — generalize `resolveRollups` to source from
   `WorkbookCellLink` (group by the linked record, aggregate a target field), closing
   the deferred custom-table-rollup gap with the platform-rollup machinery.
5. **Filters + CSV** — "links to X" filter; CSV exports the joined labels.

## Out of scope

- Two-way sync / symmetric linked fields (Airtable's reciprocal link) — a later slice
  once one-way links land.
- Link-level metadata (junction attributes) — would extend `WorkbookCellLink` later.

## Verification

A `W-LINK` line joins Phase W / RC27 (create a link-to-many column, link several
records, reload-persist, rollup over the links, filter + CSV) — exercised on the
single per-archetype portal-rebuild path, not a contributor preview.
