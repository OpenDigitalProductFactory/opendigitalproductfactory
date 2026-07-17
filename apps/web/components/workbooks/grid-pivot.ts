// Universal Grid & Workbooks — pivot table (EP-GRID-WORKBOOKS Phase 4).
//
// The 2-D generalization of the group-by summary (`grid-summary.ts`): cross a
// "rows" column against a "columns" column and aggregate a value (or count) into
// a matrix, with row / column / grand totals. Pure + unit-testable; operates over
// the rows already loaded in the grid. Totals aggregate the raw values (not the
// cell aggregates), so an `avg`/`min`/`max` total is correct rather than an
// average-of-averages.

import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";
import { toSummaryNumber } from "./grid-summary";

export type PivotAgg = "count" | "sum" | "avg" | "min" | "max";

/** How the Summary panel renders the grouped rows. */
export type SummaryMode = "table" | "chart" | "pivot";

export const PIVOT_AGG_LABELS: Record<PivotAgg, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Min",
  max: "Max",
};

/** `count` works for any value column; the rest need a numeric value column. */
export function pivotAggNeedsValue(agg: PivotAgg): boolean {
  return agg !== "count";
}

const EMPTY_KEY = "(empty)";

/** Running accumulator for one bucket (cell / row / col / grand). */
interface Acc {
  count: number; // rows in the bucket
  sum: number;
  min: number;
  max: number;
  n: number; // numeric values seen (for avg/min/max validity)
}

function newAcc(): Acc {
  return { count: 0, sum: 0, min: Infinity, max: -Infinity, n: 0 };
}

function add(acc: Acc, value: number | null): void {
  acc.count += 1;
  if (value !== null) {
    acc.sum += value;
    acc.n += 1;
    if (value < acc.min) acc.min = value;
    if (value > acc.max) acc.max = value;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Reduce an accumulator to the chosen aggregate (0 when no numeric values). */
function reduce(acc: Acc, agg: PivotAgg): number {
  switch (agg) {
    case "count":
      return acc.count;
    case "sum":
      return round2(acc.sum);
    case "avg":
      return acc.n ? round2(acc.sum / acc.n) : 0;
    case "min":
      return acc.n ? round2(acc.min) : 0;
    case "max":
      return acc.n ? round2(acc.max) : 0;
    default:
      return 0;
  }
}

/** Sort keys alphabetically, with the "(empty)" bucket always last. */
function sortKeys(keys: Iterable<string>): string[] {
  return [...keys].sort((a, b) => {
    if (a === EMPTY_KEY) return 1;
    if (b === EMPTY_KEY) return -1;
    return a.localeCompare(b);
  });
}

export interface PivotTable {
  rowKeys: string[];
  colKeys: string[];
  /** cells[rowKey][colKey] — the aggregate for that intersection (0 if empty). */
  cells: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  agg: PivotAgg;
}

/**
 * Cross `rowColumnId` (down) against `colColumnId` (across) and aggregate
 * `valueColumnId` per intersection with `agg`. When `agg` is `count` (or no value
 * column), each row contributes 1. Blank group values collapse into `(empty)`.
 */
export function pivot(
  rows: readonly GridRowData[],
  rowColumnId: string,
  colColumnId: string,
  valueColumnId: string | undefined,
  agg: PivotAgg,
): PivotTable {
  const cellAcc = new Map<string, Map<string, Acc>>();
  const rowAcc = new Map<string, Acc>();
  const colAcc = new Map<string, Acc>();
  const grand = newAcc();
  const useValue = pivotAggNeedsValue(agg) && Boolean(valueColumnId);

  for (const row of rows) {
    const rk = cellSearchText(row[rowColumnId] ?? null) || EMPTY_KEY;
    const ck = cellSearchText(row[colColumnId] ?? null) || EMPTY_KEY;
    const v = useValue ? toSummaryNumber(row[valueColumnId!] ?? null) : null;

    let byCol = cellAcc.get(rk);
    if (!byCol) cellAcc.set(rk, (byCol = new Map()));
    let acc = byCol.get(ck);
    if (!acc) byCol.set(ck, (acc = newAcc()));
    add(acc, v);

    let ra = rowAcc.get(rk);
    if (!ra) rowAcc.set(rk, (ra = newAcc()));
    add(ra, v);

    let ca = colAcc.get(ck);
    if (!ca) colAcc.set(ck, (ca = newAcc()));
    add(ca, v);

    add(grand, v);
  }

  const rowKeys = sortKeys(rowAcc.keys());
  const colKeys = sortKeys(colAcc.keys());

  const cells: Record<string, Record<string, number>> = {};
  for (const rk of rowKeys) {
    cells[rk] = {};
    const byCol = cellAcc.get(rk);
    for (const ck of colKeys) {
      const acc = byCol?.get(ck);
      cells[rk][ck] = acc ? reduce(acc, agg) : 0;
    }
  }

  const rowTotals: Record<string, number> = {};
  for (const rk of rowKeys) rowTotals[rk] = reduce(rowAcc.get(rk)!, agg);
  const colTotals: Record<string, number> = {};
  for (const ck of colKeys) colTotals[ck] = reduce(colAcc.get(ck)!, agg);

  return { rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal: reduce(grand, agg), agg };
}
