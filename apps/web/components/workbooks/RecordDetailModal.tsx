"use client";

// Universal Grid & Workbooks — record detail modal (EP-GRID-WORKBOOKS,
// BI-69371E1A). "Expand a row" into a full-record editor, now composed on the
// platform form-kit (BI-C167C45E): edits accumulate in a draft and persist only
// through the explicit Save action (routed field-by-field through the Grid's
// validated persistCell dispatch), free text edits in an auto-growing editor,
// and the field layout follows the grid view's order/visibility — hidden
// fields stay reachable behind a disclosure.

import { useCallback, useEffect, useRef } from "react";
import type { CellValue, ColumnDefinition } from "@/lib/workbooks/types";
import type { FormValues } from "@/lib/form-kit/form-state";
import type { FormFieldSpec } from "@/lib/form-kit/field-controls";
import { RecordForm } from "@/components/ui/form-kit/RecordForm";
import { confirmDialog } from "@/components/ui/Dialog";
import type { GridRowData } from "./cell-editors";
import { cellSearchText } from "./grid-filter";

export interface RecordDetailModalProps {
  row: GridRowData;
  /** Fields shown by default — the grid view's ordered, visible columns. */
  columns: ColumnDefinition[];
  /** Columns the view hides; shown behind a disclosure so nothing is lost. */
  hiddenColumns?: ColumnDefinition[];
  canEdit: boolean;
  onClose: () => void;
  /** Persist one field; the Grid wires this to its validated persistCell path. */
  onSave: (columnId: string, value: CellValue) => void;
}

function toFieldSpec(col: ColumnDefinition, canEdit: boolean): FormFieldSpec {
  return {
    fieldId: col.columnId,
    label: col.name,
    fieldType: col.fieldType,
    editable: canEdit && col.editable,
    required: col.required,
    multiline: col.config?.multiline,
    options: col.config?.options?.map((o) => ({ key: o.key, label: o.label })),
  };
}

export function RecordDetailModal({
  row,
  columns,
  hiddenColumns = [],
  canEdit,
  onClose,
  onSave,
}: RecordDetailModalProps) {
  const dirtyRef = useRef(false);

  // Every close path (Escape, backdrop, ✕) runs the same unsaved-changes guard.
  const requestClose = useCallback(async () => {
    if (dirtyRef.current) {
      const ok = await confirmDialog({
        title: "Discard unsaved changes?",
        message: "This record has edits that have not been saved.",
        confirmLabel: "Discard",
        tone: "danger",
      });
      if (!ok) return;
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const values: FormValues = {};
  for (const col of [...columns, ...hiddenColumns]) {
    values[col.columnId] = row[col.columnId] ?? null;
  }

  const renderReadOnly = (field: FormFieldSpec, value: unknown) => {
    const text = cellSearchText(value as CellValue);
    // Full content, wrapped — a read-only description must be readable, not
    // truncated to one line.
    return (
      <div className="whitespace-pre-wrap break-words text-sm text-[var(--dpf-text)]">
        {text || <span className="text-[var(--dpf-muted)]">—</span>}
      </div>
    );
  };

  return (
    <div
      className="dpf-record-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Record detail"
      onClick={() => void requestClose()}
    >
      <div className="dpf-record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dpf-record-modal-header">
          <span className="text-sm font-semibold text-[var(--dpf-text)]">Record</span>
          <button
            type="button"
            onClick={() => void requestClose()}
            aria-label="Close"
            className="rounded-md border border-[var(--dpf-border)] px-2 py-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            ✕
          </button>
        </div>
        <RecordForm
          fields={columns.map((c) => toFieldSpec(c, canEdit))}
          hiddenFields={hiddenColumns.map((c) => toFieldSpec(c, canEdit))}
          values={values}
          onDirtyChange={(dirty) => {
            dirtyRef.current = dirty;
          }}
          onSave={(dirty) => {
            for (const [columnId, value] of Object.entries(dirty)) {
              onSave(columnId, value as CellValue);
            }
          }}
          renderReadOnly={renderReadOnly}
        />
      </div>
    </div>
  );
}
