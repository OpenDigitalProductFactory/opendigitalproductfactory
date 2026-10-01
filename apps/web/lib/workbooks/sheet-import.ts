// Universal Grid & Workbooks — spreadsheet import inference (EP-GRID-WORKBOOKS Phase 3)
//
// Pure logic that turns a parsed sheet matrix (first row = headers) into a
// workbook table definition: deduped column names, an inferred field type per
// column, and typed cell rows. Kept pure + unit-testable; the server action wires
// it to the sheet reader and the workbook service.
// readSheetMatrix is the one file → matrix reader both import actions share: it
// converts every workbook (.xlsx, .xls, .ods) to .ods through the document
// engine and reads the first sheet with DPF's own OpenDocument reader
// (BI-81524041, BI-D1B40D43).

import {
  convertForIngestion,
  describeUnsupportedFormat,
  sniffOfficeContainer,
  type ConvertForIngestion,
} from "@/lib/shared/file-parsers";
import { readOdfContentXml, readOdfSheet, type OdfCell } from "@/lib/shared/odf-content";
import { conversionRouteFor, conversionRouteForName, type ConversionRoute } from "@/lib/shared/office-conversion";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import type { CellValue, FieldType } from "./types";

/** A sheet cell as the reader types it: text, number, boolean, date or blank. */
export type SheetCell = OdfCell;

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

/**
 * Why these bytes are not a spreadsheet, in plain language, or null when they
 * may be one. RTF, a non-sheet OpenDocument file or a Word/PowerPoint package
 * would otherwise fail inside the engine with an error that names neither the
 * file nor a fix (BI-65D65EC0). Unrecognised bytes pass through and the engine
 * decides.
 */
export function unreadableSheetReason(bytes: Uint8Array): string | null {
  const container = sniffOfficeContainer(bytes);
  if (container.kind === "ole") return describeUnsupportedFormat(container.format);
  if (container.kind === "rtf") return describeUnsupportedFormat("rtf");
  if (container.kind === "odf") return describeUnsupportedFormat("opendocument");
  if (container.kind === "ooxml" && container.part !== "xl") {
    return "This file is not a spreadsheet (it looks like a Word or PowerPoint file). Upload an .xlsx or CSV file.";
  }
  return null;
}

/** The sheet as a row matrix, or the plain-language reason it cannot be read. */
export type SheetReadResult = ActionResult<SheetCell[][]>;

export type SheetReadDeps = {
  convert?: ConvertForIngestion;
};

/** A workbook the sniffer could not place goes to the engine as .xlsx, which then says whether it can read it. */
const UNRECOGNISED_WORKBOOK: ConversionRoute = conversionRouteForName("upload.xlsx", "")!;

/**
 * Read an uploaded spreadsheet (not CSV) into a row matrix. Every workbook —
 * .xlsx, Excel 97-2003 or OpenDocument — is converted to .ods by the document
 * engine and its first sheet read with typed cells; with no converter it is
 * refused with a plain-language reason. Anything recognisably not a sheet is
 * refused before the engine sees it.
 */
export async function readSheetMatrix(
  input: ArrayBuffer | Uint8Array,
  fileName: string,
  deps: SheetReadDeps = {},
): Promise<SheetReadResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const route = conversionRouteFor(sniffOfficeContainer(bytes), bytes, fileName);
  if (route?.family !== "sheet") {
    const unreadable = unreadableSheetReason(bytes);
    if (unreadable) return err(unreadable);
  }
  const sheetRoute = route?.family === "sheet" ? route : UNRECOGNISED_WORKBOOK;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const converted = await convertForIngestion(buffer, sheetRoute, deps.convert);
  if (!converted.ok) return converted;
  try {
    return ok(readOdfSheet(readOdfContentXml(converted.data)).rows);
  } catch (error) {
    console.warn(`[sheet-import] converted ${sheetRoute.from} could not be read: ${getErrorMessage(error)}`);
    return err("DPF could not read this workbook; it may be damaged or password-protected. Save it as .xlsx or CSV and upload it again.");
  }
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
