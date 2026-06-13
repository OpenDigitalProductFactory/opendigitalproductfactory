"use client";

// Universal Grid & Workbooks — the Grid component (EP-GRID-WORKBOOKS)
// Library-agnostic wrapper around react-data-grid. Everything above this file
// speaks the spec's ColumnDefinition / GridRow contract; react-data-grid is an
// implementation detail contained here, so it can be swapped without touching
// the data layer, server, or pages.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  DataGrid,
  SelectColumn,
  renderTextEditor,
  type Column,
  type RowsChangeData,
  type SortColumn,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import "./dpf-grid.css";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type GridCapabilities,
  type ProvenanceKind,
  PROVENANCE_LABELS,
} from "@/lib/workbooks/types";
import {
  type GridRowData,
  NumberEditor,
  makeDateEditor,
  makeSelectEditor,
  makeCheckboxRenderer,
  makeSelectRenderer,
  makeMultiSelectRenderer,
  renderUrlCell,
  renderEmailCell,
  renderImageCell,
  ImageEditor,
  renderAttachmentCell,
  AttachmentEditor,
  renderDateCell,
  renderReferenceCell,
  renderComputedCell,
  makeReferenceEditor,
} from "./cell-editors";
import {
  createRowAction,
  updateCellsAction,
  deleteRowAction,
} from "@/lib/actions/workbooks";
import { updatePlatformCellsAction } from "@/lib/actions/platform-grid";
import {
  type GridHistory,
  EMPTY_HISTORY,
  recordEdit,
  peekUndo,
  peekRedo,
  commitUndo,
  commitRedo,
} from "./grid-history";
import { quickFilterRows, applyColumnFilters, cellSearchText, type ColumnFilters } from "./grid-filter";
import { rowsToCsv } from "./grid-csv";
import {
  type ConditionalRule,
  CF_OPERATORS,
  CF_OPERATOR_LABELS,
  CF_COLORS,
  rowColor,
  rowColorClass,
  blankRule,
  operatorNeedsValue,
} from "./grid-conditional-format";
import { summarize, numericColumns, summaryChartBars } from "./grid-summary";
import {
  viewStorageKey,
  serializeViewState,
  parseViewState,
  type SortState,
} from "./grid-view-state";

export interface WorkbookGridProps {
  /** custom WorkbookTable id (TBL-*) or, for platform data, the entity type. */
  tableId: string;
  columns: ColumnDefinition[];
  rows: GridRow[];
  capabilities: GridCapabilities;
  /**
   * "custom" = user-defined WorkbookTable (default).
   * "platform" = a live grid over platform records (e.g. backlog); edits route
   * through the domain's validated update action, not the workbook store.
   */
  source?: "custom" | "platform";
}

function toRowData(rows: GridRow[]): GridRowData[] {
  return rows.map((r) => ({ rowId: r.rowId, ...r.cells }));
}

function buildColumn(
  col: ColumnDefinition,
  canEdit: boolean,
  showProvenance: boolean,
): Column<GridRowData> {
  const options = col.config?.options ?? [];
  const label = col.required ? `${col.name} *` : col.name;
  const kind: ProvenanceKind = col.provenanceKind ?? "manual";
  const base: Column<GridRowData> = {
    key: col.columnId,
    name: label,
    resizable: true,
    sortable: true,
    width: col.width,
    minWidth: 80,
    // Progressive disclosure (Dale review): provenance is hidden until the user
    // turns on "Show data sources" — the grid reads as an ordinary spreadsheet.
    renderHeaderCell: showProvenance
      ? () => (
          <div className="dpf-grid-header">
            <span className="dpf-grid-header-name">{label}</span>
            <span className={`dpf-prov dpf-prov-${kind}`}>{PROVENANCE_LABELS[kind]}</span>
          </div>
        )
      : undefined,
  };
  const editable = canEdit && col.editable;

  switch (col.fieldType) {
    case "text":
      return { ...base, renderEditCell: editable ? renderTextEditor : undefined };
    case "url":
      return {
        ...base,
        renderCell: renderUrlCell,
        renderEditCell: editable ? renderTextEditor : undefined,
      };
    case "email":
      return {
        ...base,
        renderCell: renderEmailCell,
        renderEditCell: editable ? renderTextEditor : undefined,
      };
    case "image":
      return {
        ...base,
        renderCell: renderImageCell,
        renderEditCell: editable ? ImageEditor : undefined,
      };
    case "attachment":
      return {
        ...base,
        renderCell: renderAttachmentCell,
        renderEditCell: editable ? AttachmentEditor : undefined,
      };
    case "number":
      return { ...base, renderEditCell: editable ? NumberEditor : undefined };
    case "date":
      return {
        ...base,
        renderCell: renderDateCell(false),
        renderEditCell: editable ? makeDateEditor(false) : undefined,
      };
    case "datetime":
      return {
        ...base,
        renderCell: renderDateCell(true),
        renderEditCell: editable ? makeDateEditor(true) : undefined,
      };
    case "checkbox":
      return { ...base, renderCell: makeCheckboxRenderer(editable) };
    case "select":
      return {
        ...base,
        renderCell: makeSelectRenderer(options),
        renderEditCell: editable ? makeSelectEditor(options) : undefined,
      };
    case "multi_select":
      // Phase 1: rendered read-only in the grid; edit via API/MCP.
      return { ...base, renderCell: makeMultiSelectRenderer(options) };
    case "reference": {
      // Phase 2: editable in-cell typeahead over a live platform entity.
      const referenceType = col.config?.referenceType;
      return {
        ...base,
        renderCell: renderReferenceCell,
        renderEditCell:
          editable && referenceType ? makeReferenceEditor(referenceType) : undefined,
        // The typeahead's result list is a floating element; without this,
        // react-data-grid treats a click on it as an outside-click and commits
        // the (empty) draft before onSelect runs, so the picked reference is lost.
        editorOptions: { commitOnOutsideClick: false },
      };
    }
    case "formula":
    case "lookup":
      // Phase 2: computed read-only columns (derived server-side).
      return { ...base, renderCell: renderComputedCell };
    default:
      return base;
  }
}

function compareValues(a: CellValue, b: CellValue): number {
  const norm = (v: CellValue): string | number => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join(",");
    if (typeof v === "object") {
      if ("referenceId" in v) return v.referenceId ?? "";
      if ("url" in v) return v.name ?? v.url;
      return "";
    }
    if (typeof v === "boolean") return v ? 1 : 0;
    return v;
  };
  const av = norm(a);
  const bv = norm(b);
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
}

export function WorkbookGrid({
  tableId,
  columns,
  rows,
  capabilities,
  source = "custom",
}: WorkbookGridProps) {
  const [rowData, setRowData] = useState<GridRowData[]>(() => toRowData(rows));
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showProvenance, setShowProvenance] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [cfRules, setCfRules] = useState<ConditionalRule[]>([]);
  const cfIdRef = useRef(0);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryGroupBy, setSummaryGroupBy] = useState("");
  const [summaryValue, setSummaryValue] = useState("");
  const [summaryChart, setSummaryChart] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({});
  const activeFilterCount = Object.values(columnFilters).filter((v) => v.trim()).length;
  // Multi-step undo/redo of cell edits (distinct from the audit history). Each
  // entry's inverse replays through the same validated dispatch as a normal edit.
  const [history, setHistory] = useState<GridHistory>(EMPTY_HISTORY);

  // Persist the per-grid view (filters/sort/formatting/provenance) per tableId so
  // it survives reloads. Client-only (localStorage); hydrate once, then save on change.
  const viewHydratedRef = useRef(false);
  useEffect(() => {
    viewHydratedRef.current = false;
    try {
      const parsed = parseViewState(localStorage.getItem(viewStorageKey(tableId)));
      if (parsed) {
        if (parsed.filterQuery !== undefined) setFilterQuery(parsed.filterQuery);
        if (parsed.columnFilters) setColumnFilters(parsed.columnFilters);
        if (parsed.sort) setSortColumns(parsed.sort);
        if (parsed.cfRules) setCfRules(parsed.cfRules);
        if (parsed.showProvenance !== undefined) setShowProvenance(parsed.showProvenance);
      }
    } catch {
      // ignore unreadable storage
    }
    viewHydratedRef.current = true;
  }, [tableId]);

  useEffect(() => {
    if (!viewHydratedRef.current) return;
    try {
      const sort: SortState[] = sortColumns.map((s) => ({
        columnKey: s.columnKey,
        direction: s.direction,
      }));
      localStorage.setItem(
        viewStorageKey(tableId),
        serializeViewState({ filterQuery, columnFilters, sort, cfRules, showProvenance }),
      );
    } catch {
      // ignore quota / unavailable storage
    }
  }, [tableId, filterQuery, columnFilters, sortColumns, cfRules, showProvenance]);

  const gridColumns = useMemo<Column<GridRowData>[]>(() => {
    const cols = columns.map((c) => buildColumn(c, capabilities.canEditCell, showProvenance));
    return capabilities.canDeleteRow ? [SelectColumn, ...cols] : cols;
  }, [columns, capabilities, showProvenance]);

  const sortedRows = useMemo<GridRowData[]>(() => {
    const filtered = applyColumnFilters(
      quickFilterRows(rowData, columns, filterQuery),
      columnFilters,
    );
    if (sortColumns.length === 0) return filtered;
    const sorted = [...filtered];
    sorted.sort((ra, rb) => {
      for (const sc of sortColumns) {
        const cmp = compareValues(ra[sc.columnKey], rb[sc.columnKey]);
        if (cmp !== 0) return sc.direction === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
    return sorted;
  }, [rowData, columns, filterQuery, columnFilters, sortColumns]);

  const persistCell = useCallback(
    async (
      rowId: string,
      columnId: string,
      value: CellValue,
      prevValue: CellValue,
    ): Promise<boolean> => {
      setError(null);
      const res =
        source === "platform"
          ? await updatePlatformCellsAction(tableId, rowId, { [columnId]: value })
          : await updateCellsAction(tableId, rowId, { [columnId]: value });
      if (!res.ok) {
        setError(res.error);
        // Revert the optimistic edit so the grid doesn't show an unsaved value.
        setRowData((prev) =>
          prev.map((r) => (r.rowId === rowId ? { ...r, [columnId]: prevValue } : r)),
        );
        return false;
      }
      return true;
    },
    [tableId, source],
  );

  const onRowsChange = useCallback(
    (newRows: GridRowData[], data: RowsChangeData<GridRowData>) => {
      // newRows are in sorted order; map back into the canonical rowData by rowId.
      const byId = new Map(newRows.map((r) => [r.rowId, r]));
      const columnId = data.column.key;
      for (const idx of data.indexes) {
        const changed = newRows[idx];
        if (!changed) continue;
        const prevRow = rowData.find((r) => r.rowId === changed.rowId);
        const prevValue: CellValue = prevRow ? prevRow[columnId] ?? null : null;
        const nextValue: CellValue = changed[columnId] ?? null;
        void persistCell(changed.rowId, columnId, nextValue, prevValue).then((ok) => {
          // Only a committed edit is undoable; a rejected one is already reverted.
          if (ok) {
            setHistory((h) => recordEdit(h, { rowId: changed.rowId, columnId, prevValue, nextValue }));
          }
        });
      }
      setRowData((prev) => prev.map((r) => byId.get(r.rowId) ?? r));
    },
    [persistCell, rowData],
  );

  // Replay a cell to a target value through the validated dispatch; on success
  // commit the stack transition. A failed persist leaves history unchanged
  // (persistCell already reverted the optimistic cell).
  const undo = useCallback(() => {
    const entry = peekUndo(history);
    if (!entry) return;
    setRowData((prev) =>
      prev.map((r) => (r.rowId === entry.rowId ? { ...r, [entry.columnId]: entry.prevValue } : r)),
    );
    void persistCell(entry.rowId, entry.columnId, entry.prevValue, entry.nextValue).then((ok) => {
      if (ok) setHistory((h) => commitUndo(h));
    });
  }, [history, persistCell]);

  const redo = useCallback(() => {
    const entry = peekRedo(history);
    if (!entry) return;
    setRowData((prev) =>
      prev.map((r) => (r.rowId === entry.rowId ? { ...r, [entry.columnId]: entry.nextValue } : r)),
    );
    void persistCell(entry.rowId, entry.columnId, entry.nextValue, entry.prevValue).then((ok) => {
      if (ok) setHistory((h) => commitRedo(h));
    });
  }, [history, persistCell]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!capabilities.canEditCell) return;
      // Don't hijack a cell editor's own text undo while editing.
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    },
    [capabilities.canEditCell, undo, redo],
  );

  const onAddRow = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await createRowAction(tableId, {});
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blank: GridRowData = { rowId: res.data.rowId };
    for (const c of columns) blank[c.columnId] = c.fieldType === "multi_select" ? [] : null;
    setRowData((prev) => [...prev, blank]);
  }, [tableId, columns]);

  const onDeleteSelected = useCallback(async () => {
    if (selectedRows.size === 0) return;
    setBusy(true);
    setError(null);
    const ids = [...selectedRows];
    for (const id of ids) {
      const res = await deleteRowAction(tableId, id);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
    }
    setRowData((prev) => prev.filter((r) => !selectedRows.has(r.rowId)));
    setSelectedRows(new Set());
    setBusy(false);
  }, [tableId, selectedRows]);

  const onExportCsv = useCallback(() => {
    if (typeof document === "undefined") return;
    const csv = rowsToCsv(columns, sortedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [columns, sortedRows, tableId]);

  return (
    <div className="flex h-full flex-col gap-2" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter rows"
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
        {filterQuery.trim() && (
          <span className="text-xs text-[var(--dpf-muted)]">
            {sortedRows.length} of {rowData.length}
          </span>
        )}
        {capabilities.canAddRow && (
          <button
            type="button"
            onClick={onAddRow}
            disabled={busy || columns.length === 0}
            className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            + Add row
          </button>
        )}
        {capabilities.canDeleteRow && selectedRows.size > 0 && (
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={busy}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-error)]"
          >
            Delete {selectedRows.size} selected
          </button>
        )}
        {capabilities.canEditCell && (
          <>
            <button
              type="button"
              onClick={undo}
              disabled={history.undo.length === 0}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-40"
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={history.redo.length === 0}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] disabled:opacity-40"
              title="Redo (Ctrl+Y)"
            >
              Redo
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onExportCsv}
          disabled={columns.length === 0}
          className="ml-auto rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-40"
          title="Export the current view to CSV"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-pressed={showFilters}
          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Filter by column"
        >
          {showFilters ? "Hide filters" : "Filters"}
          {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowFormat((v) => !v)}
          aria-pressed={showFormat}
          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Highlight rows by a condition"
        >
          {showFormat ? "Hide formatting" : "Format"}
          {cfRules.length > 0 ? ` (${cfRules.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowSummary((v) => !v)}
          aria-pressed={showSummary}
          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Group rows and summarize"
        >
          {showSummary ? "Hide summary" : "Summary"}
        </button>
        <button
          type="button"
          onClick={() => setShowProvenance((v) => !v)}
          aria-pressed={showProvenance}
          className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Show where each column's values come from"
        >
          {showProvenance ? "Hide data sources" : "Show data sources"}
        </button>
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--dpf-border)] text-sm">
          <button
            type="button"
            onClick={() => setGallery(false)}
            className={
              gallery
                ? "px-2 py-1 text-[var(--dpf-muted)]"
                : "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium text-[var(--dpf-text)]"
            }
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => setGallery(true)}
            className={
              gallery
                ? "bg-[var(--dpf-surface-1)] px-2 py-1 font-medium text-[var(--dpf-text)]"
                : "px-2 py-1 text-[var(--dpf-muted)]"
            }
          >
            Gallery
          </button>
        </div>
        {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
      </div>

      {showFilters && columns.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
          {columns.map((col) => {
            const value = columnFilters[col.columnId] ?? "";
            const set = (v: string) =>
              setColumnFilters((f) => ({ ...f, [col.columnId]: v }));
            const ctrlClass =
              "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";
            if (col.fieldType === "select") {
              return (
                <select
                  key={col.columnId}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  aria-label={`Filter ${col.name}`}
                  className={ctrlClass}
                >
                  <option value="">{col.name}: any</option>
                  {(col.config?.options ?? []).map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              );
            }
            if (col.fieldType === "checkbox") {
              return (
                <select
                  key={col.columnId}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  aria-label={`Filter ${col.name}`}
                  className={ctrlClass}
                >
                  <option value="">{col.name}: any</option>
                  <option value="true">Checked</option>
                  <option value="false">Unchecked</option>
                </select>
              );
            }
            return (
              <input
                key={col.columnId}
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={col.name}
                aria-label={`Filter ${col.name}`}
                className={ctrlClass}
              />
            );
          })}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setColumnFilters({})}
              className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {showFormat && columns.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
          {cfRules.map((rule) => {
            const update = (patch: Partial<ConditionalRule>) =>
              setCfRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)));
            const ctrlClass =
              "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";
            return (
              <div key={rule.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--dpf-muted)]">Highlight when</span>
                <select
                  value={rule.columnId}
                  onChange={(e) => update({ columnId: e.target.value })}
                  aria-label="Column"
                  className={ctrlClass}
                >
                  {columns.map((c) => (
                    <option key={c.columnId} value={c.columnId}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={rule.operator}
                  onChange={(e) => update({ operator: e.target.value as ConditionalRule["operator"] })}
                  aria-label="Operator"
                  className={ctrlClass}
                >
                  {CF_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {CF_OPERATOR_LABELS[op]}
                    </option>
                  ))}
                </select>
                {operatorNeedsValue(rule.operator) && (
                  <input
                    value={rule.value}
                    onChange={(e) => update({ value: e.target.value })}
                    placeholder="value"
                    aria-label="Value"
                    className={ctrlClass}
                  />
                )}
                <select
                  value={rule.color}
                  onChange={(e) => update({ color: e.target.value as ConditionalRule["color"] })}
                  aria-label="Color"
                  className={ctrlClass}
                >
                  {CF_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className={`dpf-cf-swatch ${rowColorClass(rule.color)}`} aria-hidden="true" />
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
            onClick={() =>
              setCfRules((rs) => [...rs, blankRule(`cf-${(cfIdRef.current += 1)}`, columns)])
            }
            className="w-fit rounded-md border border-[var(--dpf-border)] px-3 py-1 text-sm text-[var(--dpf-text)]"
          >
            + Add formatting rule
          </button>
        </div>
      )}

      {showSummary && columns.length > 0 && (() => {
        const groupBy = summaryGroupBy || columns[0]!.columnId;
        const valueCol = summaryValue || undefined;
        const numCols = numericColumns(columns);
        const summary = summarize(sortedRows, groupBy, valueCol);
        const ctrlClass =
          "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";
        return (
          <div className="flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--dpf-muted)]">Group by</span>
              <select
                value={groupBy}
                onChange={(e) => setSummaryGroupBy(e.target.value)}
                aria-label="Group by column"
                className={ctrlClass}
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
                className={ctrlClass}
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
      })()}

      {columns.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] p-8 text-center text-[var(--dpf-muted)]">
          This table has no columns yet. Add a column to start entering data.
        </div>
      ) : gallery ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-1">
            {sortedRows.map((row) => {
              const color = rowColor(row, cfRules);
              return (
                <div
                  key={row.rowId}
                  className={`dpf-gallery-card rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 ${
                    color ? rowColorClass(color) : ""
                  }`}
                >
                  <dl className="flex flex-col gap-1">
                    {columns.map((col) => (
                      <div key={col.columnId} className="flex justify-between gap-2 text-sm">
                        <dt className="shrink-0 text-[var(--dpf-muted)]">{col.name}</dt>
                        <dd className="truncate text-right text-[var(--dpf-text)]" title={cellSearchText(row[col.columnId] ?? null)}>
                          {cellSearchText(row[col.columnId] ?? null)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
            {sortedRows.length === 0 && (
              <div className="text-sm text-[var(--dpf-muted)]">No rows.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <DataGrid
            className="dpf-workbook-grid"
            columns={gridColumns}
            rows={sortedRows}
            rowKeyGetter={(row) => row.rowId}
            onRowsChange={onRowsChange}
            sortColumns={sortColumns}
            onSortColumnsChange={setSortColumns}
            selectedRows={selectedRows}
            onSelectedRowsChange={setSelectedRows}
            rowClass={(row) => {
              const color = rowColor(row, cfRules);
              return color ? rowColorClass(color) : undefined;
            }}
            defaultColumnOptions={{ resizable: true, sortable: true }}
          />
        </div>
      )}
    </div>
  );
}
