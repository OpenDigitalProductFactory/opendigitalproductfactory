// Universal Grid & Workbooks — column reordering + in-grid row grouping
// (EP-GRID-WORKBOOKS Phase 3, toward Smartsheet parity).
//
// Two spreadsheet affordances the grid was missing: drag a column header to a
// new position, and collapse rows into groups by a column's value. Both are
// first-class react-data-grid features (onColumnsReorder / TreeDataGrid); the
// logic that decides the new order and buckets the rows lives here, pure and
// unit-testable — the Grid owns the react-data-grid wiring and persistence.

import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

/** Label used for a group whose group-by cell is empty. */
export const EMPTY_GROUP_LABEL = "(empty)";

/**
 * Return a new column-id order with `sourceKey` moved into `targetKey`'s slot —
 * react-data-grid's drop semantics (the dragged column takes the drop target's
 * position, the rest shift to make room). Mirrors the library's own reference
 * handler so behavior matches user expectation. An unknown key or a no-op move
 * returns a copy of the input unchanged, so a column is never dropped or
 * duplicated.
 */
export function reorderColumnIds(
  order: readonly string[],
  sourceKey: string,
  targetKey: string,
): string[] {
  const from = order.indexOf(sourceKey);
  const to = order.indexOf(targetKey);
  const next = order.slice();
  if (from === -1 || to === -1 || from === to) return next;
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
}

/**
 * Order `columns` by a saved list of column ids. Ids that no longer exist are
 * skipped; columns missing from the saved order (e.g. a column added after the
 * order was saved) are appended in their original relative order. An empty order
 * returns the input untouched. Never drops or duplicates a live column.
 */
export function applyColumnOrder(
  columns: ColumnDefinition[],
  order: readonly string[],
): ColumnDefinition[] {
  if (order.length === 0) return columns;
  const byId = new Map(columns.map((c) => [c.columnId, c]));
  const seen = new Set<string>();
  const out: ColumnDefinition[] = [];
  for (const id of order) {
    const col = byId.get(id);
    if (col && !seen.has(id)) {
      out.push(col);
      seen.add(id);
    }
  }
  for (const col of columns) if (!seen.has(col.columnId)) out.push(col);
  return out;
}

/**
 * Reorder rows for a drag-and-drop: move the row with id `dragId` into the slot
 * of `dropId` (same semantics as column drag). Returns a new array; the input is
 * untouched, and an unknown id is a no-op. Used for manual row ordering.
 */
export function reorderRowsByDrag(
  rows: readonly GridRowData[],
  dragId: string,
  dropId: string,
): GridRowData[] {
  const ids = reorderColumnIds(rows.map((r) => r.rowId), dragId, dropId);
  const byId = new Map(rows.map((r) => [r.rowId, r]));
  return ids.map((id) => byId.get(id)!);
}

/**
 * Bucket rows by a column's displayed value — the `rowGrouper` a `TreeDataGrid`
 * calls for each grouping level. Empty/blank values collapse into a single
 * `(empty)` bucket. Insertion order within a bucket is preserved (so an active
 * sort still orders rows inside each group).
 */
export function groupRowsByColumn(
  rows: readonly GridRowData[],
  columnId: string,
): Record<string, readonly GridRowData[]> {
  const out: Record<string, GridRowData[]> = {};
  for (const row of rows) {
    const key = cellSearchText(row[columnId] ?? null) || EMPTY_GROUP_LABEL;
    (out[key] ??= []).push(row);
  }
  return out;
}

/** The set of group keys (in first-seen order) for the default expand-all state. */
export function groupKeys(rows: readonly GridRowData[], columnId: string): string[] {
  return Object.keys(groupRowsByColumn(rows, columnId));
}

// --- Nested-grouping expansion model -------------------------------------
// TreeDataGrid is a controlled component: it renders exactly the group ids in
// `expandedGroupIds` and reports the full new set on every toggle. For nested
// grouping we want Smartsheet/Airtable defaults — top-level groups open, deeper
// levels closed — while remembering the user's overrides. We keep two intents:
//   collapsedGroups: top-level ids the user closed (top defaults open)
//   extraExpanded:   deeper-level ids the user opened (deeper defaults closed)
// and reconcile them against the current top-level ids each render, so groups
// that newly appear (from a filter/edit) still open by default.

/** Build the controlled expanded set from the two override intents. */
export function expandedGroupSet(
  topGroupIds: readonly unknown[],
  collapsedGroups: ReadonlySet<unknown>,
  extraExpanded: ReadonlySet<unknown>,
): Set<unknown> {
  const s = new Set<unknown>(topGroupIds.filter((id) => !collapsedGroups.has(id)));
  for (const id of extraExpanded) if (!collapsedGroups.has(id)) s.add(id);
  return s;
}

/**
 * Split the full expanded set TreeDataGrid reports back into the two intents:
 * top-level ids absent from it are collapses; any non-top ids present are the
 * user's deeper expansions to preserve verbatim.
 */
export function splitExpandedGroupIds(
  ids: ReadonlySet<unknown>,
  topGroupIds: readonly unknown[],
): { collapsedGroups: Set<unknown>; extraExpanded: Set<unknown> } {
  const topSet = new Set<unknown>(topGroupIds);
  return {
    collapsedGroups: new Set<unknown>(topGroupIds.filter((id) => !ids.has(id))),
    extraExpanded: new Set<unknown>(Array.from(ids).filter((id) => !topSet.has(id))),
  };
}
