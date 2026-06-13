// Universal Grid & Workbooks — spreadsheet import inference (EP-GRID-WORKBOOKS Phase 3)
//
// Pure logic that turns a parsed sheet matrix (first row = headers) into a
// workbook table definition: deduped column names, an inferred field type per
// column, and typed cell rows. Kept pure + unit-testable; the server action wires
// it to the .xlsx parser (read-excel-file) and the workbook service.

import type { CellValue, FieldType } from "./types";

/** What read-excel-file yields per cell. */
export type SheetCell = string | number | boolean | Date | null;

export interface ImportedColumn {
  name: string;
  fieldType: FieldType;
}

export interface ImportedTable {
  columns: ImportedColumn[];
  /** Rows keyed by column name (the action maps names → columnIds after creation). */
  rows: Record<string, CellValue>[];
  truncated: boolean;
}

export const MAX_IMPORT_COLUMNS = 100;
export const MAX_IMPORT_ROWS = 5000;

function isBlank(v: SheetCell): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Infer a column's field type from a sample of its (non-blank) values. */
export function inferFieldType(values: SheetCell[]): FieldType {
  const present = values.filter((v) => !isBlank(v));
  if (present.length === 0) return "text";
  if (present.every((v) => v instanceof Date)) return "date";
  if (present.every((v) => typeof v === "boolean")) return "checkbox";
  if (
    present.every(
      (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))),
    )
  ) {
    return "number";
  }
  return "text";
}

/** Coerce a raw sheet cell to a typed CellValue for the inferred field type. */
export function coerceImportCell(fieldType: FieldType, value: SheetCell): CellValue {
  if (isBlank(value)) return null;
  switch (fieldType) {
    case "number":
      return typeof value === "number" ? value : Number(value);
    case "checkbox":
      return typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
    case "date":
    case "datetime":
      return value instanceof Date ? value.toISOString() : String(value);
    default:
      return String(value);
  }
}

/** Make column names unique + non-empty (Excel allows blank/duplicate headers). */
export function uniqueColumnNames(header: SheetCell[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    let base = (h === null || h === undefined ? "" : String(h)).trim() || `Column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count > 0) base = `${base} ${count + 1}`;
    return base;
  });
}

/**
 * Turn a sheet matrix into an importable table. The first row is the header.
 * Empty rows are skipped; columns/rows are capped (truncated flag set when hit).
 */
export function inferTableFromSheet(matrix: SheetCell[][]): ImportedTable {
  if (matrix.length === 0) return { columns: [], rows: [], truncated: false };
  const header = (matrix[0] ?? []).slice(0, MAX_IMPORT_COLUMNS);
  const names = uniqueColumnNames(header);
  const colCount = names.length;

  const body = matrix.slice(1).filter((r) => r.some((c) => !isBlank(c)));
  const truncated = body.length > MAX_IMPORT_ROWS || (matrix[0]?.length ?? 0) > MAX_IMPORT_COLUMNS;
  const cappedBody = body.slice(0, MAX_IMPORT_ROWS);

  const columns: ImportedColumn[] = names.map((name, i) => ({
    name,
    fieldType: inferFieldType(cappedBody.map((r) => r[i] ?? null)),
  }));

  const rows = cappedBody.map((r) => {
    const obj: Record<string, CellValue> = {};
    for (let i = 0; i < colCount; i += 1) {
      obj[names[i]!] = coerceImportCell(columns[i]!.fieldType, r[i] ?? null);
    }
    return obj;
  });

  return { columns, rows, truncated };
}
