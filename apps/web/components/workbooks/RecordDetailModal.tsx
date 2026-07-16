"use client";

// Universal Grid & Workbooks — record detail modal (EP-GRID-WORKBOOKS, toward
// Airtable parity). "Expand a row" into a full-record editor: every field on its
// own line, edited through the SAME validated dispatch as an in-grid edit (the
// Grid passes an onSave that routes to persistCell). Presentational + self-
// contained; the Grid owns persistence and which row is open.

import { useEffect } from "react";
import type { CellValue, ColumnDefinition, SelectOption } from "@/lib/workbooks/types";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

export interface RecordDetailModalProps {
  row: GridRowData;
  columns: ColumnDefinition[];
  canEdit: boolean;
  onClose: () => void;
  /** Persist one field; the Grid wires this to its validated persistCell path. */
  onSave: (columnId: string, value: CellValue) => void;
}

/** Field types the modal edits inline; everything else is shown read-only. */
const INLINE_EDITABLE = new Set([
  "text",
  "url",
  "email",
  "phone",
  "number",
  "currency",
  "percent",
  "progress",
  "rating",
  "duration",
  "checkbox",
  "select",
  "date",
  "datetime",
]);

function asStr(v: CellValue): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function RecordDetailModal({
  row,
  columns,
  canEdit,
  onClose,
  onSave,
}: RecordDetailModalProps) {
  // Close on Escape — standard modal affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ctrl =
    "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";

  const field = (col: ColumnDefinition) => {
    const value = row[col.columnId] ?? null;
    const editable = canEdit && col.editable && INLINE_EDITABLE.has(col.fieldType);

    if (!editable) {
      return (
        <div className="truncate text-sm text-[var(--dpf-text)]" title={cellSearchText(value)}>
          {cellSearchText(value) || <span className="text-[var(--dpf-muted)]">—</span>}
        </div>
      );
    }

    switch (col.fieldType) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onSave(col.columnId, e.target.checked)}
            aria-label={col.name}
          />
        );
      case "select":
        return (
          <select
            className={ctrl}
            value={asStr(value)}
            onChange={(e) => onSave(col.columnId, e.target.value || null)}
            aria-label={col.name}
          >
            <option value="">—</option>
            {(col.config?.options ?? []).map((o: SelectOption) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "number":
      case "currency":
      case "percent":
      case "progress":
      case "rating":
      case "duration":
        return (
          <input
            type="number"
            className={ctrl}
            defaultValue={asStr(value)}
            onBlur={(e) => onSave(col.columnId, e.target.value === "" ? null : Number(e.target.value))}
            aria-label={col.name}
          />
        );
      case "date":
      case "datetime":
        return (
          <input
            type={col.fieldType === "datetime" ? "datetime-local" : "date"}
            className={ctrl}
            defaultValue={asStr(value).slice(0, col.fieldType === "datetime" ? 16 : 10)}
            onBlur={(e) => onSave(col.columnId, e.target.value || null)}
            aria-label={col.name}
          />
        );
      default:
        return (
          <input
            className={ctrl}
            defaultValue={asStr(value)}
            onBlur={(e) => onSave(col.columnId, e.target.value === "" ? null : e.target.value)}
            aria-label={col.name}
          />
        );
    }
  };

  return (
    <div
      className="dpf-record-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record detail"
      onClick={onClose}
    >
      <div className="dpf-record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dpf-record-modal-header">
          <span className="text-sm font-semibold text-[var(--dpf-text)]">Record</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            ✕
          </button>
        </div>
        <dl className="dpf-record-modal-body">
          {columns.map((col) => (
            <div key={col.columnId} className="dpf-record-modal-row">
              <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                {col.name}
              </dt>
              <dd>{field(col)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
