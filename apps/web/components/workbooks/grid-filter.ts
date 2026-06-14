// Universal Grid & Workbooks — client-side quick filter (EP-GRID-WORKBOOKS, Phase 2)
//
// A pure, case-insensitive substring filter across a row's visible cell values —
// the "type to narrow" affordance every spreadsheet has. Operates over the rows
// already loaded in the grid (server-side / push-down filtering for large datasets
// is a reporting-phase concern). Kept pure so it is unit-testable.

import type {
  CellValue,
  ColumnDefinition,
  ReferenceValue,
  AttachmentValue,
} from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";

/** Render a cell value to the text a user would see, for substring matching. */
export function cellSearchText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    // link cell = array of references → search/export by their labels
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null && "referenceId" in value[0]) {
      return (value as ReferenceValue[]).map((r) => r.label ?? r.referenceId).join(" ");
    }
    return value.join(" ");
  }
  if (typeof value === "object" && "referenceId" in value) {
    const ref = value as ReferenceValue;
    return ref.label ?? ref.referenceId;
  }
  if (typeof value === "object" && "url" in value) {
    const att = value as AttachmentValue;
    return att.name ?? att.url;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** True if any of the row's column values contains the (lowercased) query. */
export function rowMatchesQuery(
  row: GridRowData,
  columns: ColumnDefinition[],
  loweredQuery: string,
): boolean {
  if (!loweredQuery) return true;
  for (const col of columns) {
    if (cellSearchText(row[col.columnId] ?? null).toLowerCase().includes(loweredQuery)) {
      return true;
    }
  }
  return false;
}

/** Filter rows by a free-text query across all columns. Empty query → all rows. */
export function quickFilterRows(
  rows: GridRowData[],
  columns: ColumnDefinition[],
  query: string,
): GridRowData[] {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return rows;
  return rows.filter((r) => rowMatchesQuery(r, columns, lowered));
}

/** Per-column filters: columnId → substring the column's value must contain. */
export type ColumnFilters = Record<string, string>;

/** Keep only the non-empty filters (lowercased), as [columnId, needle] pairs. */
export function activeColumnFilters(filters: ColumnFilters): [string, string][] {
  return Object.entries(filters)
    .map(([k, v]) => [k, v.trim().toLowerCase()] as [string, string])
    .filter(([, v]) => v.length > 0);
}

/** AND-combine per-column substring filters. No active filters → all rows. */
export function applyColumnFilters(
  rows: GridRowData[],
  filters: ColumnFilters,
): GridRowData[] {
  const active = activeColumnFilters(filters);
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every(([columnId, needle]) =>
      cellSearchText(row[columnId] ?? null).toLowerCase().includes(needle),
    ),
  );
}
