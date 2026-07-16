"use client";

// Universal Grid & Workbooks — toolbar panel subcomponents (EP-GRID-WORKBOOKS).
//
// WorkbookGrid grew into a monolith because every parity feature added another
// inline toolbar panel. Extracting each panel into a typed, presentational
// component here keeps the Grid focused on data/react-data-grid wiring and lets a
// new panel land as its own file (an independent PR) instead of another block in
// Grid.tsx. Each component is pure UI over props the Grid owns.

import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import type { ColumnDefinition } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import {
  opsForField,
  isUnaryOp,
  isRangeOp,
  FILTER_OP_LABELS,
  type FilterGroup,
  type FilterCondition,
  type FilterOp,
} from "./grid-filter-builder";
import { numericColumns, summarize, summaryChartBars } from "./grid-summary";

const PANEL = "flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2";
const CTRL = "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";

// --- Structured filter builder panel ---------------------------------------

export interface GridFilterPanelProps {
  columns: ColumnDefinition[];
  filterGroup: FilterGroup;
  setFilterGroup: Dispatch<SetStateAction<FilterGroup>>;
  /** Monotonic counter for stable new-condition ids (owned by the Grid). */
  fcIdRef: MutableRefObject<number>;
}

export function GridFilterPanel({
  columns,
  filterGroup,
  setFilterGroup,
  fcIdRef,
}: GridFilterPanelProps): ReactNode {
  const update = (id: string, patch: Partial<FilterCondition>) =>
    setFilterGroup((g) => ({
      ...g,
      conditions: g.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  const colOf = (id: string) => columns.find((c) => c.columnId === id) ?? columns[0]!;

  return (
    <div className={PANEL}>
      {filterGroup.conditions.map((cond, i) => {
        const col = colOf(cond.columnId);
        const ops = opsForField(col.fieldType);
        return (
          <div key={cond.id} className="flex flex-wrap items-center gap-2">
            <span className="w-12 text-sm text-[var(--dpf-muted)]">
              {i === 0 ? "Where" : (
                <select
                  value={filterGroup.combinator}
                  onChange={(e) =>
                    setFilterGroup((g) => ({ ...g, combinator: e.target.value as FilterGroup["combinator"] }))
                  }
                  aria-label="Combine conditions"
                  className={CTRL}
                  disabled={i > 1}
                >
                  <option value="and">and</option>
                  <option value="or">or</option>
                </select>
              )}
            </span>
            <select
              value={cond.columnId}
              onChange={(e) => {
                const next = colOf(e.target.value);
                update(cond.id, { columnId: e.target.value, op: opsForField(next.fieldType)[0]! });
              }}
              aria-label="Filter column"
              className={CTRL}
            >
              {columns.map((c) => (
                <option key={c.columnId} value={c.columnId}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={cond.op}
              onChange={(e) => update(cond.id, { op: e.target.value as FilterOp })}
              aria-label="Filter operator"
              className={CTRL}
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {FILTER_OP_LABELS[op]}
                </option>
              ))}
            </select>
            {!isUnaryOp(cond.op) && (
              <input
                value={cond.value}
                onChange={(e) => update(cond.id, { value: e.target.value })}
                placeholder="value"
                aria-label="Filter value"
                className={CTRL}
              />
            )}
            {isRangeOp(cond.op) && (
              <input
                value={cond.value2 ?? ""}
                onChange={(e) => update(cond.id, { value2: e.target.value })}
                placeholder="and"
                aria-label="Filter upper value"
                className={CTRL}
              />
            )}
            <button
              type="button"
              onClick={() =>
                setFilterGroup((g) => ({
                  ...g,
                  conditions: g.conditions.filter((c) => c.id !== cond.id),
                }))
              }
              aria-label="Remove condition"
              className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const col = columns[0]!;
          setFilterGroup((g) => ({
            ...g,
            conditions: [
              ...g.conditions,
              {
                id: `fc-${(fcIdRef.current += 1)}`,
                columnId: col.columnId,
                op: opsForField(col.fieldType)[0]!,
                value: "",
              },
            ],
          }));
        }}
        className="w-fit rounded-md border border-[var(--dpf-border)] px-3 py-1 text-sm text-[var(--dpf-text)]"
      >
        + Add condition
      </button>
    </div>
  );
}

// --- Group-by summary panel (pivot-lite) -----------------------------------

export interface GridSummaryPanelProps {
  columns: ColumnDefinition[];
  sortedRows: GridRowData[];
  summaryGroupBy: string;
  setSummaryGroupBy: Dispatch<SetStateAction<string>>;
  summaryValue: string;
  setSummaryValue: Dispatch<SetStateAction<string>>;
  summaryChart: boolean;
  setSummaryChart: Dispatch<SetStateAction<boolean>>;
}

export function GridSummaryPanel({
  columns,
  sortedRows,
  summaryGroupBy,
  setSummaryGroupBy,
  summaryValue,
  setSummaryValue,
  summaryChart,
  setSummaryChart,
}: GridSummaryPanelProps): ReactNode {
  const groupBy = summaryGroupBy || columns[0]!.columnId;
  const valueCol = summaryValue || undefined;
  const numCols = numericColumns(columns);
  const summary = summarize(sortedRows, groupBy, valueCol);

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--dpf-muted)]">Group by</span>
        <select
          value={groupBy}
          onChange={(e) => setSummaryGroupBy(e.target.value)}
          aria-label="Group by column"
          className={CTRL}
        >
          {columns.map((c) => (
            <option key={c.columnId} value={c.columnId}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--dpf-muted)]">summarize</span>
        <select
          value={summaryValue}
          onChange={(e) => setSummaryValue(e.target.value)}
          aria-label="Value column"
          className={CTRL}
        >
          <option value="">count only</option>
          {numCols.map((c) => (
            <option key={c.columnId} value={c.columnId}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
          <button
            type="button"
            onClick={() => setSummaryChart(false)}
            className={
              summaryChart
                ? "px-2 py-1 text-[var(--dpf-muted)]"
                : "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium text-[var(--dpf-text)]"
            }
          >
            Table
          </button>
          <button
            type="button"
            onClick={() => setSummaryChart(true)}
            className={
              summaryChart
                ? "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium text-[var(--dpf-text)]"
                : "px-2 py-1 text-[var(--dpf-muted)]"
            }
          >
            Chart
          </button>
        </div>
      </div>
      {summaryChart ? (
        <div className="flex flex-col gap-1">
          {summaryChartBars(summary, Boolean(valueCol)).map((bar) => (
            <div key={bar.group} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 truncate text-[var(--dpf-muted)]" title={bar.group}>
                {bar.group}
              </span>
              <span className="dpf-summary-bar-track">
                <span className="dpf-summary-bar-fill" style={{ width: `${bar.pct}%` }} />
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums text-[var(--dpf-text)]">
                {bar.value}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--dpf-muted)]">
                <th className="px-2 py-1">Group</th>
                <th className="px-2 py-1">Count</th>
                {valueCol && (
                  <>
                    <th className="px-2 py-1">Sum</th>
                    <th className="px-2 py-1">Avg</th>
                    <th className="px-2 py-1">Min</th>
                    <th className="px-2 py-1">Max</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.group} className="border-t border-[var(--dpf-border)]">
                  <td className="px-2 py-1">{s.group}</td>
                  <td className="px-2 py-1">{s.count}</td>
                  {valueCol && (
                    <>
                      <td className="px-2 py-1">{s.sum}</td>
                      <td className="px-2 py-1">{s.avg}</td>
                      <td className="px-2 py-1">{s.min}</td>
                      <td className="px-2 py-1">{s.max}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
