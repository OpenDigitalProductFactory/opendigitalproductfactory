// Universal Grid & Workbooks — office export of the current view (BI-4865EB4D).
//
// The grid's Excel (.xlsx) and OpenDocument (.ods) exports go through the
// document engine: this builds the export model from what the grid shows
// (visible columns, sorted and filtered rows, formatting rules, the summary
// chart view), posts it to /api/workbooks/export, and downloads the file.
//
// When the install has no document engine, .xlsx falls back to the data-only
// writer (grid-xlsx.ts) so export never disappears; the returned notice says
// what the file is missing. .ods has no fallback writer.

import type { CellValue, ColumnDefinition } from "@/lib/workbooks/types";
import type { WorkbookExportCell, WorkbookExportModel } from "@/lib/workbooks/export-fods";
import type { WorkbookExportFormat } from "@/lib/workbooks/export-workbook";
import type { GridRowData } from "./cell-editors";
import type { ConditionalRule } from "./grid-conditional-format";
import { cellSearchText } from "./grid-filter";
import { buildXlsx, type XlsxValue } from "./grid-xlsx";

export type GridExportView = {
  tableId: string;
  columns: readonly ColumnDefinition[];
  rows: readonly GridRowData[];
  cfRules: readonly ConditionalRule[];
  /** The summary panel's chart view, when it is open in chart mode. */
  chart: { groupByColumnId: string; valueColumnId: string | null } | null;
};

const MIME: Readonly<Record<WorkbookExportFormat, string>> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

export const FALLBACK_NOTICE =
  "Exported values only: formats and formulas need document conversion, which is not available on this install.";
export const ODS_UNAVAILABLE_NOTICE = "OpenDocument export needs document conversion, which is not available on this install.";

function exportCell(value: CellValue | undefined, column: ColumnDefinition): WorkbookExportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return column.fieldType === "checkbox" ? value : cellSearchText(value);
  return cellSearchText(value);
}

/** The export model for the grid's current view. */
export function buildWorkbookExportModel(view: GridExportView): WorkbookExportModel {
  const index = new Map(view.columns.map((column, i) => [column.columnId, i] as const));
  const columns = view.columns.map((column) => ({
    name: column.name,
    fieldType: column.fieldType,
    ...(column.config?.precision !== undefined ? { precision: column.config.precision } : {}),
    ...(column.config?.currencySymbol !== undefined ? { currencySymbol: column.config.currencySymbol } : {}),
    ...(column.config?.formula !== undefined ? { formula: column.config.formula } : {}),
    ...(column.width !== undefined ? { widthPx: column.width } : {}),
  }));
  const rows = view.rows.map((row) => view.columns.map((column) => exportCell(row[column.columnId] as CellValue | undefined, column)));
  const conditionalRules = view.cfRules.flatMap((rule) => {
    const columnIndex = index.get(rule.columnId);
    return columnIndex === undefined ? [] : [{ columnIndex, operator: rule.operator, value: rule.value, color: rule.color }];
  });
  const groupIndex = view.chart ? index.get(view.chart.groupByColumnId) : undefined;
  const valueIndex = view.chart?.valueColumnId ? index.get(view.chart.valueColumnId) ?? null : null;
  return {
    sheetName: view.tableId,
    columns,
    rows,
    conditionalRules,
    chart: groupIndex === undefined ? null : { groupByColumnIndex: groupIndex, valueColumnIndex: valueIndex },
  };
}

function download(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The data-only .xlsx: display text, numbers kept as numbers (the pre-engine export). */
function fallbackXlsx(view: GridExportView): Blob {
  const header: XlsxValue[] = view.columns.map((c) => c.name);
  const dataRows: XlsxValue[][] = view.rows.map((r) =>
    view.columns.map((c) => {
      const raw = r[c.columnId];
      return typeof raw === "number" ? raw : cellSearchText((raw ?? null) as CellValue);
    }),
  );
  // Uint8Array is a valid BlobPart at runtime; the cast placates the DOM lib's
  // stricter generic (Uint8Array<ArrayBufferLike>) under TS 5.7+.
  return new Blob([buildXlsx([header, ...dataRows], { sheetName: view.tableId }) as BlobPart], { type: MIME.xlsx });
}

async function failureReason(response: Response): Promise<{ reason: string | null; message: string }> {
  try {
    const body = (await response.json()) as { message?: string; details?: { reason?: string } };
    return { reason: body.details?.reason ?? null, message: body.message ?? "The export failed." };
  } catch {
    return { reason: null, message: "The export failed." };
  }
}

/**
 * Export the view and start the download. Returns a message for the grid to
 * show (a fallback notice or the failure), or null when the file downloaded
 * as asked.
 */
export async function exportWorkbookView(
  format: WorkbookExportFormat,
  view: GridExportView,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/workbooks/export?format=${format}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWorkbookExportModel(view)),
    });
  } catch {
    response = new Response(null, { status: 503 });
  }
  if (response.ok) {
    download(await response.blob(), `${view.tableId}.${format}`);
    return null;
  }
  const { reason, message } = response.status === 503 && !response.headers.get("content-type")
    ? { reason: "converter-unavailable", message: ODS_UNAVAILABLE_NOTICE }
    : await failureReason(response);
  if (reason !== "converter-unavailable") return message;
  if (format === "ods") return ODS_UNAVAILABLE_NOTICE;
  download(fallbackXlsx(view), `${view.tableId}.xlsx`);
  return FALLBACK_NOTICE;
}
