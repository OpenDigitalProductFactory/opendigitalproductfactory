"use client";

// Universal Grid & Workbooks — the Grid component (EP-GRID-WORKBOOKS)
// Library-agnostic wrapper around react-data-grid. Everything above this file
// speaks the spec's ColumnDefinition / GridRow contract; react-data-grid is an
// implementation detail contained here, so it can be swapped without touching
// the data layer, server, or pages.

import { useCallback, useMemo, useState } from "react";
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
} from "./cell-editors";
import {
  createRowAction,
  updateCellsAction,
  deleteRowAction,
} from "@/lib/actions/workbooks";
import { updatePlatformCellsAction } from "@/lib/actions/platform-grid";

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
): Column<GridRowData> {
  const options = col.config?.options ?? [];
  const base: Column<GridRowData> = {
    key: col.columnId,
    name: col.required ? `${col.name} *` : col.name,
    resizable: true,
    sortable: true,
    width: col.width,
    minWidth: 80,
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
    case "reference":
      // Phase 1: rendered read-only until platform adapters land.
      return { ...base, renderCell: renderReferenceCell };
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

  const gridColumns = useMemo<Column<GridRowData>[]>(() => {
    const cols = columns.map((c) => buildColumn(c, capabilities.canEditCell));
    return capabilities.canDeleteRow ? [SelectColumn, ...cols] : cols;
  }, [columns, capabilities]);

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
    async (rowId: string, columnId: string, value: CellValue) => {
      setError(null);
      const res =
        source === "platform"
          ? await updatePlatformCellsAction(tableId, rowId, { [columnId]: value })
          : await updateCellsAction(tableId, rowId, { [columnId]: value });
      if (!res.ok) setError(res.error);
    },
    [tableId, source],
  );

  const onRowsChange = useCallback(
    (newRows: GridRowData[], data: RowsChangeData<GridRowData>) => {
      // newRows are in sorted order; map back into the canonical rowData by rowId.
      const byId = new Map(newRows.map((r) => [r.rowId, r]));
      setRowData((prev) => prev.map((r) => byId.get(r.rowId) ?? r));
      const columnId = data.column.key;
      for (const idx of data.indexes) {
        const changed = newRows[idx];
        if (changed) void persistCell(changed.rowId, columnId, changed[columnId] ?? null);
      }
    },
    [persistCell],
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
    <div className="flex h-full flex-col gap-2">
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
