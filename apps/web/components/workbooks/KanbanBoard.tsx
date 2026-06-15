"use client";

// Universal Grid & Workbooks — KanbanBoard (EP-GRID-WORKBOOKS, Phase 1d)
// A generic board view over the same ColumnDefinition/GridRow contract as the
// grid. Lanes come from a groupable select column; dragging a card to another
// lane updates that field through the same validated dispatch the grid uses
// (custom workbook store or the platform domain action). Native HTML5 DnD — no
// extra dependency.

import { useCallback, useMemo, useState } from "react";
import {
  type ColumnDefinition,
  type GridRow,
  type CellValue,
  type GridCapabilities,
} from "@/lib/workbooks/types";
import { groupRowsByColumn, cardFieldLayout } from "@/lib/workbooks/kanban-grouping";
import { updateCellsAction } from "@/lib/actions/workbooks";
import { updatePlatformCellsAction } from "@/lib/actions/platform-grid";

export interface KanbanBoardProps {
  source: "custom" | "platform";
  tableId: string;
  columns: ColumnDefinition[];
  rows: GridRow[];
  capabilities: GridCapabilities;
  groupByColumnId: string;
}

function formatValue(col: ColumnDefinition | undefined, value: CellValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (!col) return String(value);
  switch (col.fieldType) {
    case "select": {
      const opt = col.config?.options?.find((o) => o.key === value);
      return opt?.label ?? String(value);
    }
    case "multi_select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "date":
      return typeof value === "string" ? new Date(value).toLocaleDateString() : String(value);
    case "datetime":
      return typeof value === "string" ? new Date(value).toLocaleString() : String(value);
    case "reference":
      return typeof value === "object" && value && !Array.isArray(value) && "referenceId" in value
        ? value.label ?? value.referenceId
        : String(value);
    case "image":
    case "attachment":
      return typeof value === "object" && value && !Array.isArray(value) && "url" in value
        ? value.name ?? value.url
        : String(value);
    case "link":
      return Array.isArray(value)
        ? value
            .filter((it) => it && typeof it === "object" && "referenceId" in it)
            .map((it) => (it as { label?: string; referenceId: string }).label ?? (it as { referenceId: string }).referenceId)
            .join(", ")
        : String(value);
    default:
      return String(value);
  }
}

export function KanbanBoard({
  source,
  tableId,
  columns,
  rows,
  capabilities,
  groupByColumnId,
}: KanbanBoardProps) {
  const [rowData, setRowData] = useState<GridRow[]>(rows);
  const [error, setError] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);

  const colById = useMemo(() => new Map(columns.map((c) => [c.columnId, c])), [columns]);
  const lanes = useMemo(
    () => groupRowsByColumn(rowData, columns, groupByColumnId),
    [rowData, columns, groupByColumnId],
  );
  const { titleColumnId, metaColumnIds } = useMemo(
    () => cardFieldLayout(columns, groupByColumnId),
    [columns, groupByColumnId],
  );
  const canMove = capabilities.canEditCell;

  const move = useCallback(
    async (rowId: string, laneKey: string) => {
      const row = rowData.find((r) => r.rowId === rowId);
      if (!row) return;
      const current = row.cells[groupByColumnId];
      const currentKey = typeof current === "string" ? current : current == null ? "" : String(current);
      if (currentKey === laneKey) return;

      const nextValue: CellValue = laneKey === "" ? null : laneKey;
      const prev = rowData;
      setRowData((rs) =>
        rs.map((r) => (r.rowId === rowId ? { ...r, cells: { ...r.cells, [groupByColumnId]: nextValue } } : r)),
      );
      setError(null);

      const res =
        source === "platform"
          ? await updatePlatformCellsAction(tableId, rowId, { [groupByColumnId]: nextValue })
          : await updateCellsAction(tableId, rowId, { [groupByColumnId]: nextValue });
      if (!res.ok) {
        setRowData(prev); // revert
        setError(res.error);
      }
    },
    [rowData, groupByColumnId, source, tableId],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
        {lanes.map((lane) => (
          <div
            key={lane.key || "__unset__"}
            onDragOver={(e) => {
              if (canMove) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragRowId;
              if (id && canMove) void move(id, lane.key);
              setDragRowId(null);
            }}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--dpf-border)] px-3 py-2">
              <span className="text-sm font-medium text-[var(--dpf-text)]">{lane.label}</span>
              <span className="rounded-full bg-[var(--dpf-surface-1)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
                {lane.rows.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
              {lane.rows.map((row) => (
                <div
                  key={row.rowId}
                  draggable={canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", row.rowId);
                    e.dataTransfer.effectAllowed = "move";
                    setDragRowId(row.rowId);
                  }}
                  className={`rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 ${
                    canMove ? "cursor-grab active:cursor-grabbing" : ""
                  }`}
                >
                  {titleColumnId && (
                    <div className="text-sm font-medium text-[var(--dpf-text)]">
                      {formatValue(colById.get(titleColumnId), row.cells[titleColumnId] ?? null) || row.rowId}
                    </div>
                  )}
                  <div className="mt-1 flex flex-col gap-0.5">
                    {metaColumnIds.map((cid) => {
                      const text = formatValue(colById.get(cid), row.cells[cid] ?? null);
                      if (!text) return null;
                      return (
                        <div key={cid} className="text-xs text-[var(--dpf-muted)]">
                          <span className="opacity-70">{colById.get(cid)?.name}:</span> {text}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {lane.rows.length === 0 && (
                <div className="rounded-md border border-dashed border-[var(--dpf-border)] p-3 text-center text-xs text-[var(--dpf-muted)]">
                  Drop here
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
