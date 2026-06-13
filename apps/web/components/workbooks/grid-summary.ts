// Universal Grid & Workbooks — group-by summary (EP-GRID-WORKBOOKS Phase 4)
//
// The "pivot-lite" affordance: group the rows by one column and show count plus
// numeric aggregates (sum/avg/min/max) of another column per group. Pure +
// unit-testable; operates over the rows already loaded in the grid (full pivots
// and SQL push-down are later Phase-4 work).

import type { CellValue, ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

export interface GroupSummary {
  group: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

const EMPTY_GROUP = "(empty)";

/** Coerce a cell to a finite number, or null if it isn't numeric. */
export function toSummaryNumber(value: CellValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = typeof value === "number" ? value : Number(cellSearchText(value));
  return Number.isFinite(n) ? n : null;
}

/** Columns whose values are meaningfully summable (numeric). */
export function numericColumns(columns: ColumnDefinition[]): ColumnDefinition[] {
  return columns.filter((c) => c.fieldType === "number");
}

/** Round to 2dp without floating-point noise. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Group rows by `groupByColumnId` and aggregate `valueColumnId` (optional) per
 * group. Groups are returned sorted by descending count, then group label.
 */
export function summarize(
  rows: GridRowData[],
  groupByColumnId: string,
  valueColumnId?: string,
): GroupSummary[] {
  const counts = new Map<string, number>();
  const values = new Map<string, number[]>();
  for (const row of rows) {
    const key = cellSearchText(row[groupByColumnId] ?? null) || EMPTY_GROUP;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (valueColumnId) {
      const n = toSummaryNumber(row[valueColumnId] ?? null);
      if (n !== null) {
        const bucket = values.get(key) ?? [];
        bucket.push(n);
        values.set(key, bucket);
      }
    }
  }

  const out: GroupSummary[] = [];
  for (const [group, count] of counts) {
    const nums = values.get(group) ?? [];
    const sum = nums.reduce((s, v) => s + v, 0);
    out.push({
      group,
      count,
      sum: round2(sum),
      avg: nums.length ? round2(sum / nums.length) : 0,
      min: nums.length ? round2(Math.min(...nums)) : 0,
      max: nums.length ? round2(Math.max(...nums)) : 0,
    });
  }
  out.sort((a, b) => b.count - a.count || a.group.localeCompare(b.group));
  return out;
}

export interface SummaryBar {
  group: string;
  value: number;
  /** 0–100, relative to the largest bar (for a CSS bar width). */
  pct: number;
}

/**
 * Turn a summary into chart bars: the bar value is the chosen metric's `sum` when
 * a value column is set, else the group `count`. `pct` is relative to the max bar.
 */
export function summaryChartBars(summary: GroupSummary[], hasValueColumn: boolean): SummaryBar[] {
  const value = (s: GroupSummary) => (hasValueColumn ? s.sum : s.count);
  const max = summary.reduce((m, s) => Math.max(m, value(s)), 0);
  return summary.map((s) => ({
    group: s.group,
    value: value(s),
    pct: max > 0 ? Math.round((value(s) / max) * 100) : 0,
  }));
}
