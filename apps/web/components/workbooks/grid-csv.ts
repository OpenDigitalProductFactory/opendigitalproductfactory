// Universal Grid & Workbooks — CSV export (EP-GRID-WORKBOOKS, Phase 3)
//
// Serialize the rows currently shown in the grid (already filtered + sorted) to
// RFC-4180-ish CSV. Pure + unit-testable; the browser download is a thin wrapper
// in the Grid component. Reuses cellSearchText so exported values match what the
// user sees (reference labels, joined multi-selects, etc.).

import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";
import { escapeCsvField, toCsv } from "@/lib/shared/csv";

// Field escaping + RFC-4180 serialization centralized in lib/shared/csv; this
// module keeps the grid-specific column/cell projection (cellSearchText) so
// exported values match what the user sees.
export { escapeCsvField };

/** Build a CSV document (header row + one row per record) for the given columns. */
export function rowsToCsv(columns: ColumnDefinition[], rows: GridRowData[]): string {
  const header = columns.map((c) => c.name);
  const body = rows.map((row) =>
    columns.map((c) => cellSearchText(row[c.columnId] ?? null)),
  );
  return toCsv(body, header);
}
