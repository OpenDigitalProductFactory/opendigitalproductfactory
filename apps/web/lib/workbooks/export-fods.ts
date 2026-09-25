// Workbook -> flat ODS (BI-4865EB4D, slice S5 of BI-815D40C6).
//
// The Workbook export writes one flat OpenDocument spreadsheet (.fods: a single
// XML document) and lets the dpf-doctools engine turn it into .xlsx or .ods.
// Flat ODS is the engine's own format, so the engine does the hard part of each
// target (OOXML packaging, chart parts, conditional-format records) and DPF owns
// one small, testable writer instead of a hand-rolled writer per format.
//
// What it carries from the grid's current view:
//   - cells, typed: numbers as floats, checkboxes as booleans, date fields as
//     dates, everything else as text;
//   - column number formats: precision, currency symbol, percent, dates;
//   - formula columns as real formulas (formula/to-openformula.ts) with the
//     platform's computed value cached, or the value alone when the formula
//     cannot be expressed faithfully;
//   - the grid's conditional-format rules as row-level conditional formats;
//   - the summary chart view, as a "Chart data" sheet with a bar chart over it
//     (an embedded chart object, so the file goes through dpf-render's trusted
//     document mode, not dpf-convert; BI-BFF142A1).
// Pure and deterministic: the same model always yields the same XML.

import type { CfColor, CfOperator } from "@/components/workbooks/grid-conditional-format";
import type { FieldType } from "./types";
import { normalizeName } from "./formula/evaluate";
import { columnLetter, toOpenFormula } from "./formula/to-openformula";

export type WorkbookExportCell = string | number | boolean | null;

export type WorkbookExportColumn = {
  name: string;
  fieldType: FieldType;
  /** Decimal places for number columns. */
  precision?: number;
  currencySymbol?: string;
  /** The column's Workbook formula (formula columns). */
  formula?: string;
  widthPx?: number;
};

/** A grid conditional-format rule, pointing at a column of the export by index. */
export type WorkbookExportRule = { columnIndex: number; operator: CfOperator; value: string; color: CfColor };

/** The grid's summary chart view: one bar per group of `groupByColumnIndex`. */
export type WorkbookExportChart = {
  groupByColumnIndex: number;
  /** Bars sum this column per group; null counts the rows per group. */
  valueColumnIndex: number | null;
};

export type WorkbookExportModel = {
  sheetName: string;
  columns: WorkbookExportColumn[];
  rows: WorkbookExportCell[][];
  conditionalRules: WorkbookExportRule[];
  chart: WorkbookExportChart | null;
};

export const CHART_SHEET_NAME = "Chart data";
const EMPTY_GROUP = "(empty)";
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_VALUE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(:\d{2}(\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/;

/** Fills for the grid's rule colours. A file carries literal colours; there are no theme tokens in it. */
const RULE_FILLS: Readonly<Record<CfColor, string>> = {
  red: "#f8d7da", // style-drift-allow: an office-file fill, not portal UI
  amber: "#fff3cd", // style-drift-allow: an office-file fill, not portal UI
  green: "#d4edda", // style-drift-allow: an office-file fill, not portal UI
  blue: "#d6e9f8", // style-drift-allow: an office-file fill, not portal UI
};

const NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"',
  'xmlns:calcext="urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"',
].join(" ");

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sheet names may not carry `[]*?:/\'` and are capped at 31 characters (the xlsx limit). */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:']/g, " ").replace(/\s+/g, " ").trim().slice(0, 31).trim();
  return cleaned || "Sheet1";
}

/** `'Sheet'.A1`-style absolute reference used by ranges and chart addresses. */
function sheetRef(sheet: string, column: number, row: number): string {
  return `'${sheet}'.${columnLetter(column)}${row}`;
}

// ── Number formats ──────────────────────────────────────────────────────────────

type DataStyle = { name: string; xml: string };

function numberElement(decimals: number): string {
  return `<number:number number:decimal-places="${decimals}" number:min-decimal-places="${decimals}" number:min-integer-digits="1" number:grouping="true"/>`;
}

function clampDecimals(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 && value! <= 10 ? value! : fallback;
}

/** The number style a column's cells use, or null for the default. */
function dataStyleFor(column: WorkbookExportColumn): DataStyle | null {
  const type = column.fieldType === "formula" ? null : column.fieldType;
  if (type === "number" && column.precision !== undefined) {
    const d = clampDecimals(column.precision, 0);
    return { name: `N-num-${d}`, xml: numberElement(d) };
  }
  if (type === "currency") {
    const d = clampDecimals(column.precision, 2);
    const symbol = (column.currencySymbol ?? "$").slice(0, 8);
    const key = [...symbol].map((c) => c.codePointAt(0)!.toString(16)).join("");
    return { name: `N-cur-${key}-${d}`, xml: `<number:text>${escapeXml(symbol)}</number:text>${numberElement(d)}` };
  }
  if (type === "percent") {
    // The Workbook stores the percent itself (50 means 50%), so the sign is text, not a scale.
    const d = clampDecimals(column.precision, 0);
    return { name: `N-pct-${d}`, xml: `${numberElement(d)}<number:text>%</number:text>` };
  }
  return null;
}

const DATE_STYLE = `<number:date-style style:name="N-date"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/></number:date-style>`;
const DATETIME_STYLE = `<number:date-style style:name="N-datetime"><number:year number:style="long"/><number:text>-</number:text><number:month number:style="long"/><number:text>-</number:text><number:day number:style="long"/><number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:date-style>`;

// ── Cells ──────────────────────────────────────────────────────────────────────

function textParagraphs(value: string): string {
  return value.split(/\r?\n/).map((line) => `<text:p>${escapeXml(line)}</text:p>`).join("");
}

function cellXml(value: WorkbookExportCell, column: WorkbookExportColumn, styleName: string | null, formula: string | null): string {
  const style = styleName ? ` table:style-name="${styleName}"` : "";
  const f = formula ? ` table:formula="${escapeXml(formula)}"` : "";
  if (value === null || value === "") return formula ? `<table:table-cell${style}${f} office:value-type="string" office:string-value=""/>` : `<table:table-cell${style}/>`;
  if (typeof value === "boolean") {
    return `<table:table-cell${style}${f} office:value-type="boolean" office:boolean-value="${value}"><text:p>${value ? "TRUE" : "FALSE"}</text:p></table:table-cell>`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `<table:table-cell${style}${f} office:value-type="string"><text:p>${escapeXml(String(value))}</text:p></table:table-cell>`;
    return `<table:table-cell${style}${f} office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
  }
  if (!formula && (column.fieldType === "date" || column.fieldType === "datetime")) {
    const iso = isoDateValue(value);
    if (iso) return `<table:table-cell${style} office:value-type="date" office:date-value="${iso}"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
  }
  return `<table:table-cell${style}${f} office:value-type="string">${textParagraphs(value)}</table:table-cell>`;
}

/** An ISO date or date-time as an ODF date value (no zone), or null. */
function isoDateValue(value: string): string | null {
  const trimmed = value.trim();
  if (DATE_VALUE.test(trimmed)) return trimmed;
  const match = DATETIME_VALUE.exec(trimmed);
  if (!match) return null;
  const time = match[2]!.length === 5 ? `${match[2]}:00` : match[2]!.replace(/\.\d+$/, "");
  return `${match[1]}T${time}`;
}

// ── Conditional formats ─────────────────────────────────────────────────────────

/** The row-level condition for a rule on column `ref` (e.g. `$C2`), or null when it can never match. */
function ruleCondition(rule: WorkbookExportRule, ref: string): string | null {
  const target = rule.value.trim();
  const quoted = `"${target.replace(/"/g, '""')}"`;
  const text = `LOWER(${ref})`;
  switch (rule.operator) {
    case "eq":
      return `${text}=LOWER(${quoted})`;
    case "neq":
      return `${text}<>LOWER(${quoted})`;
    case "contains":
      return target ? `ISNUMBER(FIND(LOWER(${quoted});${text}))` : null;
    case "empty":
      return `LEN(${ref})=0`;
    case "notEmpty":
      return `LEN(${ref})>0`;
    case "gt":
    case "lt": {
      if (target === "" || !Number.isFinite(Number(target))) return null;
      return `AND(ISNUMBER(${ref});${ref}${rule.operator === "gt" ? ">" : "<"}${Number(target)})`;
    }
    default:
      return null;
  }
}

function conditionalFormatsXml(model: WorkbookExportModel, sheet: string): string {
  if (model.rows.length === 0 || model.columns.length === 0) return "";
  const lastRow = model.rows.length + 1;
  const lastColumn = model.columns.length - 1;
  const conditions = model.conditionalRules
    .map((rule) => {
      if (!Number.isInteger(rule.columnIndex) || rule.columnIndex < 0 || rule.columnIndex > lastColumn) return "";
      const condition = ruleCondition(rule, `$${columnLetter(rule.columnIndex)}2`);
      if (!condition) return "";
      return `<calcext:condition calcext:apply-style-name="dpf-cf-${rule.color}" calcext:value="formula-is(${escapeXml(condition)})" calcext:base-cell-address="${escapeXml(sheetRef(sheet, 0, 2))}"/>`;
    })
    .join("");
  if (!conditions) return "";
  const range = `${sheetRef(sheet, 0, 2)}:${sheetRef(sheet, lastColumn, lastRow)}`;
  return `<calcext:conditional-formats><calcext:conditional-format calcext:target-range-address="${escapeXml(range)}">${conditions}</calcext:conditional-format></calcext:conditional-formats>`;
}

// ── Chart ──────────────────────────────────────────────────────────────────────

export type ChartBar = { label: string; value: number };

function groupLabel(value: WorkbookExportCell): string {
  if (value === null || value === "") return EMPTY_GROUP;
  return String(value);
}

function numeric(value: WorkbookExportCell): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The chart's bars, computed the way the grid's summary panel computes them
 * (grid-summary.ts): count per group, or the value column's sum per group,
 * ordered by count descending, then label.
 */
export function chartBars(model: WorkbookExportModel, chart: WorkbookExportChart): ChartBar[] {
  const groups = new Map<string, { count: number; sum: number }>();
  for (const row of model.rows) {
    const label = groupLabel(row[chart.groupByColumnIndex] ?? null);
    const group = groups.get(label) ?? { count: 0, sum: 0 };
    group.count += 1;
    if (chart.valueColumnIndex !== null) group.sum += numeric(row[chart.valueColumnIndex] ?? null) ?? 0;
    groups.set(label, group);
  }
  return [...groups.entries()]
    .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
    .map(([label, g]) => ({ label, value: chart.valueColumnIndex === null ? g.count : Math.round(g.sum * 100) / 100 }));
}

const CHART_NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
].join(" ");

/** Both axes show their labels; without a style an axis is written with none. */
const CHART_STYLES = `<office:automatic-styles><style:style style:name="dpf-axis" style:family="chart"><style:chart-properties chart:display-label="true"/></style:style></office:automatic-styles>`;

function stringCell(value: string): string {
  return `<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}

function floatCell(value: number): string {
  return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
}

/**
 * The bar chart as an embedded chart sub-document over the Chart data sheet:
 * categories in column A, values in column B, the header row as labels. The
 * local table caches the same numbers, as office suites write it. dpf-convert
 * refuses any ODF file with an embedded object (DisableActiveContent), so this
 * document goes through dpf-render's trusted document mode, which screens it
 * and accepts exactly this shape (BI-BFF142A1).
 */
function chartFrameXml(bars: ChartBar[], groupName: string, valueName: string): string {
  const sheet = CHART_SHEET_NAME;
  const last = bars.length + 1;
  const range = (from: string, to: string) => escapeXml(`${from}:${to}`);
  const all = range(sheetRef(sheet, 0, 1), sheetRef(sheet, 1, last));
  const categories = range(sheetRef(sheet, 0, 2), sheetRef(sheet, 0, last));
  const values = range(sheetRef(sheet, 1, 2), sheetRef(sheet, 1, last));
  const title = `${valueName} by ${groupName}`;
  // Below the data rows (about 0.45 cm each), so a printout keeps the chart on the page with its numbers.
  const chartTop = `${((bars.length + 2) * 0.5).toFixed(2)}cm`;
  const localTable = [
    `<table:table table:name="local-table">`,
    `<table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column/></table:table-columns>`,
    `<table:table-header-rows><table:table-row><table:table-cell><text:p/></table:table-cell>${stringCell(valueName)}</table:table-row></table:table-header-rows>`,
    `<table:table-rows>${bars.map((bar) => `<table:table-row>${stringCell(bar.label)}${floatCell(bar.value)}</table:table-row>`).join("")}</table:table-rows>`,
    `</table:table>`,
  ].join("");
  return [
    `<table:shapes><draw:frame draw:z-index="0" draw:name="${escapeXml(title.slice(0, 100))}" svg:width="16cm" svg:height="9cm" svg:x="0.5cm" svg:y="${chartTop}">`,
    `<draw:object draw:notify-on-update-of-ranges="${all}">`,
    `<office:document ${CHART_NAMESPACES} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.chart">${CHART_STYLES}`,
    `<office:body><office:chart><chart:chart chart:class="chart:bar" svg:width="16cm" svg:height="9cm">`,
    `<chart:title><text:p>${escapeXml(title)}</text:p></chart:title>`,
    `<chart:plot-area table:cell-range-address="${all}" chart:data-source-has-labels="both">`,
    `<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="dpf-axis"><chart:categories table:cell-range-address="${categories}"/></chart:axis>`,
    `<chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="dpf-axis"/>`,
    `<chart:series chart:class="chart:bar" chart:values-cell-range-address="${values}" chart:label-cell-address="${escapeXml(sheetRef(sheet, 1, 1))}"/>`,
    `</chart:plot-area>${localTable}</chart:chart></office:chart></office:body></office:document>`,
    `</draw:object></draw:frame></table:shapes>`,
  ].join("");
}

/** The chart view as its own sheet: one row per bar, and the bar chart over them. */
function chartSheetXml(model: WorkbookExportModel, chart: WorkbookExportChart): string {
  const bars = chartBars(model, chart);
  if (bars.length === 0) return "";
  const groupName = model.columns[chart.groupByColumnIndex]?.name ?? "Group";
  const valueName = chart.valueColumnIndex === null ? "Count" : `Sum of ${model.columns[chart.valueColumnIndex]?.name ?? "value"}`;
  const header = `<table:table-row><table:table-cell table:style-name="ce-head" office:value-type="string"><text:p>${escapeXml(groupName)}</text:p></table:table-cell><table:table-cell table:style-name="ce-head" office:value-type="string"><text:p>${escapeXml(valueName)}</text:p></table:table-cell></table:table-row>`;
  const rows = bars.map((bar) => `<table:table-row>${stringCell(bar.label)}${floatCell(bar.value)}</table:table-row>`).join("");
  return `<table:table table:name="${escapeXml(CHART_SHEET_NAME)}">${chartFrameXml(bars, groupName, valueName)}<table:table-column table:style-name="co-wide"/><table:table-column table:style-name="co-wide"/>${header}${rows}</table:table>`;
}

// ── Document ───────────────────────────────────────────────────────────────────

function columnWidthCm(widthPx: number | undefined): string {
  const px = Number.isFinite(widthPx) && widthPx! > 0 ? Math.min(Math.max(widthPx!, 40), 800) : 120;
  return `${(px * 0.0264583).toFixed(3)}cm`;
}

/** The flat ODS document for a Workbook export. */
export function buildFlatOds(model: WorkbookExportModel): string {
  const sheet = sanitizeSheetName(model.sheetName);
  const nameToColumn = new Map(model.columns.map((column, index) => [normalizeName(column.name), index] as const));

  const dataStyles = new Map<string, DataStyle>();
  const columnStyle: Array<string | null> = model.columns.map((column, index) => {
    const data = dataStyleFor(column);
    if (data) {
      dataStyles.set(data.name, data);
      return `ce-${data.name}`;
    }
    if (column.fieldType === "date") return "ce-N-date";
    if (column.fieldType === "datetime") return "ce-N-datetime";
    void index;
    return null;
  });

  const cellStyles = [...new Set(columnStyle.filter((name): name is string => name !== null))]
    .map((name) => `<style:style style:name="${name}" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="${name.slice(3)}"/>`)
    .join("");
  const columnStyles = model.columns
    .map((column, index) => `<style:style style:name="co${index}" style:family="table-column"><style:table-column-properties style:column-width="${columnWidthCm(column.widthPx)}"/></style:style>`)
    .join("");

  const columnsXml = model.columns.map((_, index) => `<table:table-column table:style-name="co${index}"/>`).join("");
  const headerXml = `<table:table-row>${model.columns
    .map((column) => `<table:table-cell table:style-name="ce-head" office:value-type="string"><text:p>${escapeXml(column.name)}</text:p></table:table-cell>`)
    .join("")}</table:table-row>`;
  const rowsXml = model.rows
    .map((row, rowIndex) => {
      const sheetRow = rowIndex + 2;
      const cells = model.columns.map((column, index) => {
        const formula = column.fieldType === "formula" && column.formula ? toOpenFormula(column.formula, { columns: nameToColumn, row: sheetRow }) : null;
        return cellXml(row[index] ?? null, column, columnStyle[index] ?? null, formula);
      });
      return `<table:table-row>${cells.join("")}</table:table-row>`;
    })
    .join("");

  const ruleStyles = (Object.keys(RULE_FILLS) as CfColor[])
    .map((color) => `<style:style style:name="dpf-cf-${color}" style:family="table-cell" style:parent-style-name="Default"><style:table-cell-properties fo:background-color="${RULE_FILLS[color]}"/></style:style>`)
    .join("");

  const chartXml = model.chart ? chartSheetXml(model, model.chart) : "";
  const numberStyles = [...dataStyles.values()].map((style) => `<number:number-style style:name="${style.name}">${style.xml}</number:number-style>`).join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<office:document ${NAMESPACES} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">`,
    `<office:styles><style:style style:name="Default" style:family="table-cell"/>${ruleStyles}</office:styles>`,
    `<office:automatic-styles>${numberStyles}${DATE_STYLE}${DATETIME_STYLE}`,
    `<style:style style:name="ce-head" style:family="table-cell" style:parent-style-name="Default"><style:text-properties fo:font-weight="bold"/></style:style>`,
    `<style:style style:name="co-wide" style:family="table-column"><style:table-column-properties style:column-width="4cm"/></style:style>`,
    `${cellStyles}${columnStyles}</office:automatic-styles>`,
    `<office:body><office:spreadsheet>`,
    `<table:table table:name="${escapeXml(sheet)}">${columnsXml}${headerXml}${rowsXml}${conditionalFormatsXml(model, sheet)}</table:table>`,
    chartXml,
    `</office:spreadsheet></office:body></office:document>`,
  ].join("\n");
}
