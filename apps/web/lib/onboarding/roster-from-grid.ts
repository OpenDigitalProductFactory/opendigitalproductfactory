// EP-ONBOARDING-INTAKE P4 (grid convergence) — bridge the Universal Grid
// (EP-GRID-WORKBOOKS) to the employee-roster mapper. A roster the operator
// uploaded and EDITED in the live grid (a custom WorkbookTable) is read back as
// columns + rows and run through the same deterministic `mapRosterToEmployees`
// that powers the CSV path — so "load XLS/CSV -> fix in the grid -> create
// employees" reuses one mapping contract. Pure: no DB, fully testable.

import type { CellValue, ColumnDefinition, GridRow } from "@/lib/workbooks/types";
import { mapRosterToEmployees, type RosterMappingResult } from "./roster-import";

/** Flatten any grid CellValue to the plain string the roster mapper expects. */
export function cellToString(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    // multi_select (string[]) or link (ReferenceValue[]) — join the display parts.
    return v.map((it) => cellToString(it as CellValue)).filter(Boolean).join("; ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.label === "string" && o.label) return o.label; // reference / link label
    if (typeof o.referenceId === "string") return o.referenceId;
    if (typeof o.name === "string") return o.name; // attachment
    return "";
  }
  return String(v);
}

/**
 * Map an edited grid table (its columns + rows) to proposed employees by reusing
 * the CSV roster mapper. Column NAMES drive role detection (same fuzzy header
 * matching), grid cells become the plain-string row values.
 */
export function mapGridToEmployees(
  columns: ColumnDefinition[],
  rows: GridRow[],
): RosterMappingResult {
  const columnNames = columns.map((c) => c.name);
  const grid = rows.map((r) => columns.map((c) => cellToString(r.cells[c.columnId] ?? null)));
  return mapRosterToEmployees(columnNames, grid);
}
