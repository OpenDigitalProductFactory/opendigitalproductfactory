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
import {
  pivot,
  pivotAggNeedsValue,
  PIVOT_AGG_LABELS,
  type PivotAgg,
  type SummaryMode,
} from "./grid-pivot";
import {
  type ConditionalRule,
  CF_OPERATORS,
  CF_OPERATOR_LABELS,
  CF_COLORS,
  rowColorClass,
  blankRule,
  operatorNeedsValue,
} from "./grid-conditional-format";
import { ROW_HEIGHTS, type RowHeight } from "./grid-view-options";
import {
  availableAggs,
  toFooterAgg,
  FOOTER_AGG_LABELS,
  type FooterAgg,
} from "./grid-footer-summary";
import { GridSelect } from "./GridSelect";
import { FieldTypeIcon } from "./grid-field-icons";

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
              {i === 0 ? (
                "Where"
              ) : i === 1 ? (
                <GridSelect
                  value={filterGroup.combinator}
                  options={[
                    { value: "and", label: "and" },
                    { value: "or", label: "or" },
                  ]}
                  onChange={(v) =>
                    setFilterGroup((g) => ({ ...g, combinator: v as FilterGroup["combinator"] }))
                  }
                  ariaLabel="Combine conditions"
                  variant="bare"
                />
              ) : (
                filterGroup.combinator
              )}
            </span>
            <GridSelect
              value={cond.columnId}
              options={columns.map((c) => ({
                value: c.columnId,
                label: c.name,
                icon: <FieldTypeIcon fieldType={c.fieldType} />,
              }))}
              onChange={(v) => {
                const next = colOf(v);
                update(cond.id, { columnId: v, op: opsForField(next.fieldType)[0]! });
              }}
              ariaLabel="Filter column"
            />
            <GridSelect
              value={cond.op}
              options={ops.map((op) => ({ value: op, label: FILTER_OP_LABELS[op] }))}
              onChange={(v) => update(cond.id, { op: v as FilterOp })}
              ariaLabel="Filter operator"
            />
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
  summaryMode: SummaryMode;
  setSummaryMode: Dispatch<SetStateAction<SummaryMode>>;
  /** Pivot "across" column + the aggregate applied to each cell. */
  summaryPivotCol: string;
  setSummaryPivotCol: Dispatch<SetStateAction<string>>;
  summaryAgg: PivotAgg;
  setSummaryAgg: Dispatch<SetStateAction<PivotAgg>>;
}

const MODES: SummaryMode[] = ["table", "chart", "pivot"];
const MODE_LABELS: Record<SummaryMode, string> = { table: "Table", chart: "Chart", pivot: "Pivot" };
const PIVOT_AGGS: PivotAgg[] = ["count", "sum", "avg", "min", "max"];

export function GridSummaryPanel({
  columns,
  sortedRows,
  summaryGroupBy,
  setSummaryGroupBy,
  summaryValue,
  setSummaryValue,
  summaryMode,
  setSummaryMode,
  summaryPivotCol,
  setSummaryPivotCol,
  summaryAgg,
  setSummaryAgg,
}: GridSummaryPanelProps): ReactNode {
  const groupBy = summaryGroupBy || columns[0]!.columnId;
  const valueCol = summaryValue || undefined;
  const numCols = numericColumns(columns);
  const summary = summarize(sortedRows, groupBy, valueCol);
  // Pivot "across" axis defaults to the first column that isn't the row axis.
  const pivotCol =
    summaryPivotCol || columns.find((c) => c.columnId !== groupBy)?.columnId || columns[0]!.columnId;
  const showValuePicker = summaryMode !== "pivot" || pivotAggNeedsValue(summaryAgg);
  const p = summaryMode === "pivot" ? pivot(sortedRows, groupBy, pivotCol, valueCol, summaryAgg) : null;

  return (
    <div className={PANEL}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--dpf-muted)]">
          {summaryMode === "pivot" ? "Rows" : "Group by"}
        </span>
        <GridSelect
          value={groupBy}
          options={columns.map((c) => ({
            value: c.columnId,
            label: c.name,
            icon: <FieldTypeIcon fieldType={c.fieldType} />,
          }))}
          onChange={setSummaryGroupBy}
          ariaLabel={summaryMode === "pivot" ? "Pivot row column" : "Group by column"}
        />
        {summaryMode === "pivot" && (
          <>
            <span className="text-sm text-[var(--dpf-muted)]">Columns</span>
            <GridSelect
              value={pivotCol}
              options={columns.map((c) => ({
                value: c.columnId,
                label: c.name,
                icon: <FieldTypeIcon fieldType={c.fieldType} />,
              }))}
              onChange={setSummaryPivotCol}
              ariaLabel="Pivot column"
            />
            <GridSelect
              value={summaryAgg}
              options={PIVOT_AGGS.map((a) => ({ value: a, label: PIVOT_AGG_LABELS[a] }))}
              onChange={(v) => setSummaryAgg(v as PivotAgg)}
              ariaLabel="Pivot aggregate"
            />
          </>
        )}
        {showValuePicker && (
          <>
            <span className="text-sm text-[var(--dpf-muted)]">
              {summaryMode === "pivot" ? "of" : "summarize"}
            </span>
            <GridSelect
              value={summaryValue}
              options={[
                { value: "", label: summaryMode === "pivot" ? "—" : "count only" },
                ...numCols.map((c) => ({
                  value: c.columnId,
                  label: c.name,
                  icon: <FieldTypeIcon fieldType={c.fieldType} />,
                })),
              ]}
              onChange={setSummaryValue}
              ariaLabel="Value column"
            />
          </>
        )}
        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSummaryMode(m)}
              className={
                summaryMode === m
                  ? "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium text-[var(--dpf-text)]"
                  : "px-2 py-1 text-[var(--dpf-muted)]"
              }
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      {summaryMode === "pivot" && p ? (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--dpf-muted)]">
                <th className="px-2 py-1" />
                {p.colKeys.map((ck) => (
                  <th key={ck} className="px-2 py-1 text-right tabular-nums">
                    {ck}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {p.rowKeys.map((rk) => (
                <tr key={rk} className="border-t border-[var(--dpf-border)]">
                  <th className="px-2 py-1 text-left font-normal text-[var(--dpf-muted)]">{rk}</th>
                  {p.colKeys.map((ck) => (
                    <td key={ck} className="px-2 py-1 text-right tabular-nums text-[var(--dpf-text)]">
                      {p.cells[rk]![ck]}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-[var(--dpf-text)]">
                    {p.rowTotals[rk]}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-[var(--dpf-border)] font-semibold">
                <th className="px-2 py-1 text-left">Total</th>
                {p.colKeys.map((ck) => (
                  <td key={ck} className="px-2 py-1 text-right tabular-nums text-[var(--dpf-text)]">
                    {p.colTotals[ck]}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums text-[var(--dpf-text)]">
                  {p.grandTotal}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : summaryMode === "chart" ? (
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

// --- Conditional-formatting (Format) panel ---------------------------------

export interface GridFormatPanelProps {
  columns: ColumnDefinition[];
  cfRules: ConditionalRule[];
  setCfRules: Dispatch<SetStateAction<ConditionalRule[]>>;
  /** Monotonic counter for stable new-rule ids (owned by the Grid). */
  cfIdRef: MutableRefObject<number>;
}

export function GridFormatPanel({
  columns,
  cfRules,
  setCfRules,
  cfIdRef,
}: GridFormatPanelProps): ReactNode {
  return (
    <div className={PANEL}>
      {cfRules.map((rule) => {
        const update = (patch: Partial<ConditionalRule>) =>
          setCfRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
        return (
          <div key={rule.id} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--dpf-muted)]">Highlight when</span>
            <GridSelect
              value={rule.columnId}
              options={columns.map((c) => ({
                value: c.columnId,
                label: c.name,
                icon: <FieldTypeIcon fieldType={c.fieldType} />,
              }))}
              onChange={(v) => update({ columnId: v })}
              ariaLabel="Column"
            />
            <GridSelect
              value={rule.operator}
              options={CF_OPERATORS.map((op) => ({ value: op, label: CF_OPERATOR_LABELS[op] }))}
              onChange={(v) => update({ operator: v as ConditionalRule["operator"] })}
              ariaLabel="Operator"
            />
            {operatorNeedsValue(rule.operator) && (
              <input
                value={rule.value}
                onChange={(e) => update({ value: e.target.value })}
                placeholder="value"
                aria-label="Value"
                className={CTRL}
              />
            )}
            <GridSelect
              value={rule.color}
              options={CF_COLORS.map((c) => ({
                value: c,
                label: c,
                icon: <span className={`dpf-cf-swatch ${rowColorClass(c)}`} aria-hidden="true" />,
              }))}
              onChange={(v) => update({ color: v as ConditionalRule["color"] })}
              ariaLabel="Color"
            />
            <button
              type="button"
              onClick={() => setCfRules((rs) => rs.filter((r) => r.id !== rule.id))}
              className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              aria-label="Remove rule"
            >
              ✕
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setCfRules((rs) => [...rs, blankRule(`cf-${(cfIdRef.current += 1)}`, columns)])}
        className="w-fit rounded-md border border-[var(--dpf-border)] px-3 py-1 text-sm text-[var(--dpf-text)]"
      >
        + Add formatting rule
      </button>
    </div>
  );
}

// --- In-grid grouping (Group) panel ----------------------------------------

export interface GridGroupPanelProps {
  columns: ColumnDefinition[];
  effectiveGroupBy: string[];
  setGroupBy: Dispatch<SetStateAction<string[]>>;
  /** Reset collapse/expand intents (owned by the Grid). */
  resetGroupExpansion: () => void;
  grouping: boolean;
  topGroupIds: readonly string[];
  setCollapsedGroups: Dispatch<SetStateAction<ReadonlySet<unknown>>>;
  setExtraExpanded: Dispatch<SetStateAction<ReadonlySet<unknown>>>;
  /** Visible columns (in order) — used for the per-column subtotal pickers. */
  visibleCols: ColumnDefinition[];
  footerAgg: Record<string, FooterAgg>;
  setFooterAgg: Dispatch<SetStateAction<Record<string, FooterAgg>>>;
}

export function GridGroupPanel({
  columns,
  effectiveGroupBy,
  setGroupBy,
  resetGroupExpansion,
  grouping,
  topGroupIds,
  setCollapsedGroups,
  setExtraExpanded,
  visibleCols,
  footerAgg,
  setFooterAgg,
}: GridGroupPanelProps): ReactNode {
  const available = columns.filter((c) => !effectiveGroupBy.includes(c.columnId));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <span className="text-sm text-[var(--dpf-muted)]">Group by</span>
      {/* Ordered group-by levels: each chip is one level (outer → inner). */}
      {effectiveGroupBy.map((id, level) => {
        const col = columns.find((c) => c.columnId === id);
        if (!col) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]"
          >
            <span className="text-xs text-[var(--dpf-muted)]">{level + 1}</span>
            {col.name}
            <button
              type="button"
              aria-label={`Remove grouping by ${col.name}`}
              onClick={() => {
                setGroupBy(effectiveGroupBy.filter((g) => g !== id));
                resetGroupExpansion();
              }}
              className="ml-0.5 text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              ×
            </button>
          </span>
        );
      })}
      {available.length > 0 && (
        <GridSelect
          value=""
          options={available.map((c) => ({
            value: c.columnId,
            label: c.name,
            icon: <FieldTypeIcon fieldType={c.fieldType} />,
          }))}
          onChange={(v) => {
            setGroupBy([...effectiveGroupBy, v]);
            resetGroupExpansion();
          }}
          ariaLabel={effectiveGroupBy.length ? "Add group-by level" : "Group by column"}
          placeholder={effectiveGroupBy.length ? "add level…" : "none"}
        />
      )}
      {grouping && (
        <>
          <button
            type="button"
            onClick={resetGroupExpansion}
            className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => {
              setCollapsedGroups(new Set(topGroupIds));
              setExtraExpanded(new Set());
            }}
            className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            Collapse all
          </button>
          <span className="text-xs text-[var(--dpf-muted)]">
            {effectiveGroupBy.length > 1 ? `${effectiveGroupBy.length} levels · ` : ""}
            {topGroupIds.length} group{topGroupIds.length === 1 ? "" : "s"}
          </span>
          {/* Subtotals: only the *active* ones show (a compact chip per column
              with an inline aggregate + remove), plus one "add" picker — instead
              of a dropdown for every column. Shown here, not just the footer bar,
              because TreeDataGrid hides the footer while grouped. Same footerAgg. */}
          {(() => {
            const active = visibleCols.filter((c) => (footerAgg[c.columnId] ?? "none") !== "none");
            const inactive = visibleCols.filter((c) => (footerAgg[c.columnId] ?? "none") === "none");
            return (
              <div className="flex w-full flex-wrap items-center gap-2 border-t border-[var(--dpf-border)] pt-2">
                <span className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Subtotals</span>
                {active.map((c) => (
                  <span
                    key={c.columnId}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-sm text-[var(--dpf-text)]"
                  >
                    <span className="text-[var(--dpf-muted)]">{c.name}</span>
                    <GridSelect
                      value={footerAgg[c.columnId] ?? "count"}
                      options={availableAggs(c.fieldType)
                        .filter((a) => a !== "none")
                        .map((a) => ({ value: a, label: FOOTER_AGG_LABELS[a] }))}
                      onChange={(v) =>
                        setFooterAgg((prev) => ({ ...prev, [c.columnId]: toFooterAgg(v) }))
                      }
                      ariaLabel={`Subtotal aggregate for ${c.name}`}
                      variant="bare"
                    />
                    <button
                      type="button"
                      onClick={() => setFooterAgg((prev) => ({ ...prev, [c.columnId]: "none" }))}
                      aria-label={`Remove subtotal for ${c.name}`}
                      className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {inactive.length > 0 && (
                  <GridSelect
                    value=""
                    options={inactive.map((c) => ({ value: c.columnId, label: c.name }))}
                    onChange={(v) => {
                      const col = visibleCols.find((c) => c.columnId === v);
                      if (!col) return;
                      const def: FooterAgg = availableAggs(col.fieldType).includes("sum")
                        ? "sum"
                        : "count";
                      setFooterAgg((prev) => ({ ...prev, [col.columnId]: def }));
                    }}
                    ariaLabel="Add a subtotal"
                    placeholder={active.length ? "+ add…" : "+ add a subtotal…"}
                  />
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

// --- Row height / freeze / hide-fields (Columns) panel ----------------------

export interface GridColumnsPanelProps {
  orderedColumns: ColumnDefinition[];
  visibleColsCount: number;
  rowHeight: RowHeight;
  setRowHeight: Dispatch<SetStateAction<RowHeight>>;
  effectiveFrozen: number;
  setFrozenCount: Dispatch<SetStateAction<number>>;
  showFooter: boolean;
  setShowFooter: Dispatch<SetStateAction<boolean>>;
  hiddenColumns: string[];
  setHiddenColumns: Dispatch<SetStateAction<string[]>>;
}

export function GridColumnsPanel({
  orderedColumns,
  visibleColsCount,
  rowHeight,
  setRowHeight,
  effectiveFrozen,
  setFrozenCount,
  showFooter,
  setShowFooter,
  hiddenColumns,
  setHiddenColumns,
}: GridColumnsPanelProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--dpf-muted)]">Row height</span>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
          {(Object.keys(ROW_HEIGHTS) as RowHeight[]).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setRowHeight(h)}
              className={
                rowHeight === h
                  ? "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium capitalize text-[var(--dpf-text)]"
                  : "px-2 py-1 capitalize text-[var(--dpf-muted)]"
              }
            >
              {h}
            </button>
          ))}
        </div>
        <span className="text-sm text-[var(--dpf-muted)]">Freeze first</span>
        <GridSelect
          value={String(effectiveFrozen)}
          options={Array.from({ length: Math.max(1, visibleColsCount) }, (_, i) => i).map((n) => ({
            value: String(n),
            label: n === 0 ? "no columns" : `${n} column${n === 1 ? "" : "s"}`,
          }))}
          onChange={(v) => setFrozenCount(Number(v))}
          ariaLabel="Freeze first N columns"
        />
        <label className="inline-flex items-center gap-1 text-sm text-[var(--dpf-text)]">
          <input type="checkbox" checked={showFooter} onChange={() => setShowFooter((v) => !v)} />
          Summary bar
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-[var(--dpf-muted)]">Fields</span>
        {orderedColumns.map((col) => {
          const hidden = hiddenColumns.includes(col.columnId);
          return (
            <label
              key={col.columnId}
              className="inline-flex items-center gap-1 text-sm text-[var(--dpf-text)]"
            >
              <input
                type="checkbox"
                checked={!hidden}
                onChange={() =>
                  setHiddenColumns((prev) =>
                    hidden ? prev.filter((id) => id !== col.columnId) : [...prev, col.columnId],
                  )
                }
              />
              {col.name}
            </label>
          );
        })}
        {hiddenColumns.length > 0 && (
          <button
            type="button"
            onClick={() => setHiddenColumns([])}
            className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
}
