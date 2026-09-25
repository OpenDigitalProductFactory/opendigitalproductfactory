// Workbook export through the document engine (BI-4865EB4D, slice S5 of
// BI-815D40C6).
//
// The grid posts the view it shows (columns, rows, rules, chart) as a
// WorkbookExportModel. This validates it, writes it as flat ODS
// (export-fods.ts), and has the dpf-doctools engine convert that to .xlsx or
// .ods. The model carries data the caller already holds on screen, so export
// reads nothing from the database and grants nothing new.
//
// Expected failures come back typed and never throw. `converter-unavailable`
// is the caller's cue to fall back to the data-only .xlsx writer
// (components/workbooks/grid-xlsx.ts), which needs no engine.

import { CF_COLORS, CF_OPERATORS } from "@/components/workbooks/grid-conditional-format";
import { err, ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";
import { convertDocument, type ConversionFailureReason } from "@/lib/documents/conversion/convert";
import { CONVERTER_TARGET_MIME } from "@/lib/documents/conversion/formats";
import { contentFilename } from "@/lib/documents/document-content";
import { FIELD_TYPES, MAX_GRID_ROWS, type FieldType } from "./types";
import {
  buildFlatOds,
  type WorkbookExportCell,
  type WorkbookExportChart,
  type WorkbookExportColumn,
  type WorkbookExportModel,
  type WorkbookExportRule,
} from "./export-fods";

export const WORKBOOK_EXPORT_FORMATS = ["xlsx", "ods"] as const;
export type WorkbookExportFormat = (typeof WORKBOOK_EXPORT_FORMATS)[number];

export const MAX_EXPORT_COLUMNS = 200;
export const MAX_EXPORT_RULES = 50;
const MAX_TEXT = 32_767; // the xlsx cell limit
const MAX_NAME = 255;

const RULE_OPERATORS: ReadonlySet<string> = new Set(CF_OPERATORS);
const RULE_COLORS: ReadonlySet<string> = new Set(CF_COLORS);

export function isWorkbookExportFormat(value: unknown): value is WorkbookExportFormat {
  return typeof value === "string" && (WORKBOOK_EXPORT_FORMATS as readonly string[]).includes(value);
}

export type WorkbookExportFailureReason = ConversionFailureReason | "invalid-model";
export type WorkbookExportFailure = ActionFailure & { reason: WorkbookExportFailureReason };
export type WorkbookExportFile = { bytes: Buffer; mimeType: string; filename: string };
export type WorkbookExportResult = ActionSuccess<WorkbookExportFile> | WorkbookExportFailure;

const invalid = (error: string): WorkbookExportFailure => ({ ...err(error), reason: "invalid-model" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown, length: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
}

function parseColumn(value: unknown): WorkbookExportColumn | null {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.fieldType !== "string") return null;
  if (!(FIELD_TYPES as readonly string[]).includes(value.fieldType)) return null;
  const column: WorkbookExportColumn = { name: value.name.slice(0, MAX_NAME), fieldType: value.fieldType as FieldType };
  if (typeof value.precision === "number") column.precision = value.precision;
  if (typeof value.currencySymbol === "string") column.currencySymbol = value.currencySymbol;
  if (typeof value.formula === "string") column.formula = value.formula.slice(0, 2_000);
  if (typeof value.widthPx === "number") column.widthPx = value.widthPx;
  return column;
}

function parseCell(value: unknown): WorkbookExportCell | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, MAX_TEXT);
  return undefined;
}

/** Validate an untrusted export request body into a model, or say what is wrong with it. */
export function parseWorkbookExportModel(input: unknown): ActionSuccess<WorkbookExportModel> | WorkbookExportFailure {
  if (!isRecord(input)) return invalid("The export request is not an object.");
  if (!Array.isArray(input.columns) || input.columns.length === 0) return invalid("The export has no columns.");
  if (input.columns.length > MAX_EXPORT_COLUMNS) return invalid(`An export holds at most ${MAX_EXPORT_COLUMNS} columns.`);
  const columns: WorkbookExportColumn[] = [];
  for (const raw of input.columns) {
    const column = parseColumn(raw);
    if (!column) return invalid("A column is missing its name or has an unknown field type.");
    columns.push(column);
  }

  if (!Array.isArray(input.rows)) return invalid("The export has no rows array.");
  if (input.rows.length > MAX_GRID_ROWS) return invalid(`An export holds at most ${MAX_GRID_ROWS} rows.`);
  const rows: WorkbookExportCell[][] = [];
  for (const raw of input.rows) {
    if (!Array.isArray(raw) || raw.length > columns.length) return invalid("A row does not match the columns.");
    const row: WorkbookExportCell[] = [];
    for (const cell of raw) {
      const parsed = parseCell(cell);
      if (parsed === undefined) return invalid("A cell holds a value that is not text, a number, a boolean or empty.");
      row.push(parsed);
    }
    rows.push(row);
  }

  const rulesInput = Array.isArray(input.conditionalRules) ? input.conditionalRules : [];
  if (rulesInput.length > MAX_EXPORT_RULES) return invalid(`An export holds at most ${MAX_EXPORT_RULES} rules.`);
  const conditionalRules: WorkbookExportRule[] = [];
  for (const raw of rulesInput) {
    if (
      !isRecord(raw) ||
      !isIndex(raw.columnIndex, columns.length) ||
      typeof raw.operator !== "string" ||
      !RULE_OPERATORS.has(raw.operator) ||
      typeof raw.color !== "string" ||
      !RULE_COLORS.has(raw.color)
    ) {
      return invalid("A formatting rule is not valid.");
    }
    conditionalRules.push({
      columnIndex: raw.columnIndex,
      operator: raw.operator as WorkbookExportRule["operator"],
      value: typeof raw.value === "string" ? raw.value.slice(0, MAX_NAME) : "",
      color: raw.color as WorkbookExportRule["color"],
    });
  }

  let chart: WorkbookExportChart | null = null;
  if (input.chart !== undefined && input.chart !== null) {
    const raw = input.chart;
    const valueIndex = isRecord(raw) ? raw.valueColumnIndex : undefined;
    if (!isRecord(raw) || !isIndex(raw.groupByColumnIndex, columns.length) || !(valueIndex === null || isIndex(valueIndex, columns.length))) {
      return invalid("The chart is not valid.");
    }
    chart = {
      groupByColumnIndex: raw.groupByColumnIndex,
      valueColumnIndex: valueIndex as number | null,
    };
  }

  const sheetName = typeof input.sheetName === "string" ? input.sheetName : "Sheet1";
  return ok({ sheetName, columns, rows, conditionalRules, chart });
}

/** Export a Workbook view as .xlsx or .ods through the engine. */
export async function exportWorkbook(
  model: WorkbookExportModel,
  format: WorkbookExportFormat,
  deps: { convert?: typeof convertDocument } = {},
): Promise<WorkbookExportResult> {
  const convert = deps.convert ?? convertDocument;
  const fods = Buffer.from(buildFlatOds(model), "utf-8");
  const converted = await convert({ input: fods, from: "fods", to: format });
  if (!converted.ok) return { ...err(converted.error), reason: converted.reason };
  return ok({
    bytes: converted.data.bytes,
    mimeType: converted.data.mime || CONVERTER_TARGET_MIME[format],
    filename: contentFilename(model.sheetName, format),
  });
}
