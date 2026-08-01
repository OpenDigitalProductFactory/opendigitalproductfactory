# Universal Grid — Visual Refinement & Cell Interactions

**Epic**: EP-GRID-WORKBOOKS (refinement track)
**Date**: 2026-07-24
**Status**: Active — POC shipped (#3539); rollout in progress
**Related**: [2026-03-23-universal-grid-workbooks-design.md](2026-03-23-universal-grid-workbooks-design.md), [phase-2 plan](../plans/2026-06-11-universal-grid-workbooks-phase2.md)

## Problem

The Universal Grid reached functional parity with Airtable/Smartsheet (grouping,
subtotals, pivots, saved views, calendar, drag-reorder). But operator feedback on
the *feel* is clear:

> "Most of the interaction is basic text vs refined graphical for the menus… you
> can easily multi-select cells for update or copy/paste in other systems."

Two distinct gaps:

1. **Visual** — the grid was built functional-first on **raw native controls**
   (`<select>`, plain text buttons, native checkboxes). It never adopted the
   design system DPF already ships, so it reads as utilitarian, not refined.
2. **Cell interactions** — no spreadsheet-grade cell selection: range select,
   block copy/paste, and fill-handle are table-stakes in Excel/Airtable/Smartsheet
   and absent here.

## Substrate already present (adopt, don't invent)

- **`lucide-react`** — icon set (already a dependency, used across the app).
- **`@floating-ui/react`** — popover/menu positioning + a11y hooks.
- **`report-kit/` + `form/`** — a styled component kit (`FilterBar`, `ExportButton`,
  `SelectField`, `DataTable`…) the grid bypassed.

The refinement is therefore mostly **routing the grid through the design system
that already exists**, not creating a new one — no new dependency.

## Design decisions

### D1 — `GridSelect` is the standard dropdown primitive
A single styled dropdown (`components/workbooks/GridSelect.tsx`, floating-ui
listbox): button trigger (value + chevron), floating option list with hover/active
states, an optional per-option icon, a check on the selected row, keyboard
list-navigation, portal + flip/shift, dismiss-on-outside. It is a **like-for-like
replacement** for every native `<select>` in the grid — same choices, plus keyboard
nav and a selected indicator — so it lowers cognitive load without adding decisions.
A `variant="bare"` is used inside chips.

### D2 — Icon system
One lucide icon per toolbar action (Export → Download, Filters → Filter, Format →
Palette, Summary → BarChart3, Group → Layers, Columns → SlidersHorizontal,
data-sources → Info, Views → Bookmark), plus **field-type icons** (`fieldTypeIcon`)
shown in column pickers and headers (# number, calendar date/datetime, check
checkbox, list select, etc.). Icons are decorative (`aria-hidden`); the text label
and `aria-label` remain the accessible name. Toggle buttons get an `aria-pressed`
active-colour state.

### D3 — Cell interactions (staged)
- **Single-cell copy/paste** (`onCellCopy`/`onCellPaste`) — copy writes the cell's
  display text; paste routes the new value through the existing
  `onRowsChange → persistCell` validation (editable cells only). *(Shipped in the POC.)*
- **Rectangular range selection + block copy/paste** — react-data-grid v7 has **no
  built-in range selection**, so this is custom: track an anchor+focus cell via
  `onSelectedCellChange`, render a range overlay, and serialize/paste a TSV block
  across the rectangle (row-major), still routing each cell through `persistCell`.
- **Fill-handle** — drag the selection's corner to fill down/right, built on the
  library's `FillEvent` where available plus the range model above.

### Non-goals (this track)
Multi-cursor real-time collaboration; a full theming engine; replacing
react-data-grid. Range-select is scoped to a rectangle (not multi-range).

## Slice plan

- **S1 — POC (SHIPPED #3539).** `GridSelect`; icon toolbar with active states;
  single-cell copy/paste; Group-panel selects converted. Calibration slice.
- **S2 — Full visual rollout (this PR).** Convert **every** remaining native
  `<select>` in the Filter / Summary / Format / Columns panels to `GridSelect`;
  add `fieldTypeIcon` to column pickers + headers; icons on the Views menu and the
  grid/gallery/calendar view toggle; consistent control sizing/focus.
- **S3 — Range selection + block copy/paste — SHIPPED.** Anchor+focus range model
  (`grid-range.ts`, unit-tested); click / Shift+click / Shift+Arrow select a
  rectangle, highlighted via `cellClass`. `Ctrl+C` writes an Excel-compatible TSV
  block to the clipboard (a single cell writes its text); `Ctrl+V` fills a 1×1
  clipboard across the selection or lays a TSV block out from the selected cell —
  every written cell through the same validated `persistCell` as a manual edit;
  `Delete` clears a multi-cell selection. Native `onCellCopy`/`onCellPaste` events
  (synchronous, so it round-trips with Excel). Flat grid only.
- **S4 — Fill-handle + fill down/right + cut + select-all — SHIPPED.** `Ctrl+D` /
  `Ctrl+R` fill the selection's top row down / left column across (pure, unit-tested
  `fillDownWrites`/`fillRightWrites`); `Ctrl+X` copies then clears; `Ctrl+A` selects
  every cell. The **drag fill-handle** is react-data-grid's built-in `onFill` (flat
  grid only) — dragging the active cell's corner copies its value down/up the column
  through the validated `persistCell`. Excel cell parity for the flat grid is now
  complete. **Decomposition follow-up:** extract the range/fill logic from `Grid.tsx`
  into a `useCellRange` hook (Grid.tsx is 1653 LOC).

## Accessibility & testing

- `GridSelect` is a `role=listbox` with `role=option` items, arrow-key navigation,
  Enter/Escape, and focus management via floating-ui — keyboard- and
  screen-reader-usable; icons never carry meaning alone.
- Pure helpers (e.g. range serialization in S3, a `fieldTypeIcon` map) are
  unit-tested; `GridSelect` behavior is exercised by the panels that use it.
- Verified live on the backlog grid after each deploy (icons render, dropdowns
  open/keyboard-navigate, copy/paste round-trips through validation).
