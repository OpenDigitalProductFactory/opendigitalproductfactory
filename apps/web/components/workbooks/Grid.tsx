"use client";

// Universal Grid & Workbooks — the Grid component (EP-GRID-WORKBOOKS)
// Library-agnostic wrapper around react-data-grid. Everything above this file
// speaks the spec's ColumnDefinition / GridRow contract; react-data-grid is an
// implementation detail contained here, so it can be swapped without touching
// the data layer, server, or pages.

import { useCallback, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
    if (typeof v === "object") return v.referenceId ?? "";
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
  // Multi-step undo/redo of cell edits (distinct from the audit history). Each
  // entry's inverse replays through the same validated dispatch as a normal edit.
  const [history, setHistory] = useState<GridHistory>(EMPTY_HISTORY);

  const gridColumns = useMemo<Column<GridRowData>[]>(() => {
    const cols = columns.map((c) => buildColumn(c, capabilities.canEditCell, showProvenance));
    return capabilities.canDeleteRow ? [SelectColumn, ...cols] : cols;
  }, [columns, capabilities, showProvenance]);

  const sortedRows = useMemo<GridRowData[]>(() => {
    if (sortColumns.length === 0) return rowData;
    const sorted = [...rowData];
    sorted.sort((ra, rb) => {
      for (const sc of sortColumns) {
        const cmp = compareValues(ra[sc.columnKey], rb[sc.columnKey]);
        if (cmp !== 0) return sc.direction === "DESC" ? -cmp : cmp;
      }
      return 0;
    });
    return sorted;
  }, [rowData, sortColumns]);

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

  return (
    <div className="flex h-full flex-col gap-2" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
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
          onClick={() => setShowProvenance((v) => !v)}
          aria-pressed={showProvenance}
          className="ml-auto rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          title="Show where each column's values come from"
        >
          {showProvenance ? "Hide data sources" : "Show data sources"}
        </button>
        {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
      </div>

      {columns.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] p-8 text-center text-[var(--dpf-muted)]">
          This table has no columns yet. Add a column to start entering data.
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
            defaultColumnOptions={{ resizable: true, sortable: true }}
          />
        </div>
      )}
    </div>
  );
}
