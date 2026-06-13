// Universal Grid & Workbooks — CSV export (EP-GRID-WORKBOOKS, Phase 3)
//
// Serialize the rows currently shown in the grid (already filtered + sorted) to
// RFC-4180-ish CSV. Pure + unit-testable; the browser download is a thin wrapper
// in the Grid component. Reuses cellSearchText so exported values match what the
// user sees (reference labels, joined multi-selects, etc.).

import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

/** Quote a field if it contains a comma, quote, or newline; double interior quotes. */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Build a CSV document (header row + one row per record) for the given columns. */
export function rowsToCsv(columns: ColumnDefinition[], rows: GridRowData[]): string {
  const header = columns.map((c) => escapeCsvField(c.name)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => escapeCsvField(cellSearchText(row[c.columnId] ?? null))).join(","),
  );
  return [header, ...body].join("\r\n");
}
