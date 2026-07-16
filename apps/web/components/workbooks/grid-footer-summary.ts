// Universal Grid & Workbooks — per-column footer summary bar (EP-GRID-WORKBOOKS,
// toward Airtable/Smartsheet parity).
//
// The bottom bar every best-in-class grid has: pick an aggregate per column
// (count / filled / empty / unique for any field; sum / average / min / max for
// numbers) and see it under the column, recomputed as you filter. Pure +
// unit-testable; the Grid owns the react-data-grid summary-row wiring and
// persistence.

import type { CellValue, ColumnDefinition, FieldType } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";
import { toSummaryNumber } from "./grid-summary";

export type FooterAgg =
  | "none"
  | "count"
  | "filled"
  | "empty"
  | "unique"
  | "sum"
  | "avg"
  | "min"
  | "max";

/** Aggregates valid for any field. */
const UNIVERSAL_AGGS: FooterAgg[] = ["none", "count", "filled", "empty", "unique"];
/** Aggregates that only make sense over numeric fields. */
const NUMERIC_AGGS: FooterAgg[] = ["sum", "avg", "min", "max"];

export const FOOTER_AGG_LABELS: Record<FooterAgg, string> = {
  none: "—",
  count: "Count",
  filled: "Filled",
  empty: "Empty",
  unique: "Unique",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};

/** True when the field's values are meaningfully numeric. */
function isNumericField(fieldType: FieldType): boolean {
  return fieldType === "number";
}

/** The aggregates offered for a column, given its field type. */
export function availableAggs(fieldType: FieldType): FooterAgg[] {
  return isNumericField(fieldType) ? [...UNIVERSAL_AGGS, ...NUMERIC_AGGS] : UNIVERSAL_AGGS;
}

/** True if a cell counts as "filled" (non-empty). Matches the empty/filled split. */
function isFilled(value: CellValue): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the footer aggregate for one column over the given rows, returning the
 * display string (empty string for `none` or when a numeric aggregate has no
 * numbers). Numeric aggregates coerce via the same `toSummaryNumber` the group
 * summary uses; a numeric aggregate requested on a non-numeric column falls back
 * to whatever numbers can be coerced (so it never throws), but the UI only offers
 * numeric aggregates on numeric columns.
 */
export function computeFooter(
  rows: readonly GridRowData[],
  columnId: string,
  agg: FooterAgg,
): string {
  if (agg === "none") return "";
  if (agg === "count") return String(rows.length);

  if (agg === "filled" || agg === "empty" || agg === "unique") {
    let filled = 0;
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row[columnId] ?? null;
      if (isFilled(v)) {
        filled += 1;
        seen.add(cellSearchText(v));
      }
    }
    if (agg === "filled") return String(filled);
    if (agg === "empty") return String(rows.length - filled);
    return String(seen.size); // unique (non-empty distinct values)
  }

  // Numeric aggregates.
  const nums: number[] = [];
  for (const row of rows) {
    const n = toSummaryNumber(row[columnId] ?? null);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return "";
  switch (agg) {
    case "sum":
      return String(round2(nums.reduce((s, v) => s + v, 0)));
    case "avg":
      return String(round2(nums.reduce((s, v) => s + v, 0) / nums.length));
    case "min":
      return String(round2(Math.min(...nums)));
    case "max":
      return String(round2(Math.max(...nums)));
    default:
      return "";
  }
}

/**
 * Precompute every column's footer display value from the current agg selection.
 * Returned map is keyed by columnId (only columns with a non-`none` agg appear).
 */
export function computeFooterRow(
  rows: readonly GridRowData[],
  columns: ColumnDefinition[],
  aggs: Record<string, FooterAgg>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    const agg = aggs[col.columnId] ?? "none";
    if (agg === "none") continue;
    out[col.columnId] = computeFooter(rows, col.columnId, agg);
  }
  return out;
}

/** True if any column has an aggregate selected (i.e. the bar should render). */
export function hasFooterAggs(aggs: Record<string, FooterAgg>): boolean {
  return Object.values(aggs).some((a) => a && a !== "none");
}

/** Coerce an unknown string to a FooterAgg, or `none`. */
export function toFooterAgg(v: unknown): FooterAgg {
  const all: FooterAgg[] = [...UNIVERSAL_AGGS, ...NUMERIC_AGGS];
  return all.includes(v as FooterAgg) ? (v as FooterAgg) : "none";
}
