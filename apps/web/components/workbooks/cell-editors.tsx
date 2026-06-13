"use client";

// Universal Grid & Workbooks — cell editors + display renderers (EP-GRID-WORKBOOKS)
// Factories that produce react-data-grid renderEditCell / renderCell functions
// bound to a column's field config. Keeps Grid.tsx declarative.

import type { ReactNode } from "react";
import type { RenderEditCellProps, RenderCellProps } from "react-data-grid";
import type { CellValue, SelectOption, ReferenceValue } from "@/lib/workbooks/types";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import { searchReferencesAction } from "@/lib/actions/workbooks";

/** Flat row shape react-data-grid consumes: rowId + a value per columnId. */
export type GridRowData = { rowId: string } & Record<string, CellValue>;

function asString(v: CellValue): string {
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

export function NumberEditor({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellProps<GridRowData>): ReactNode {
  const v = row[column.key];
  return (
    <input
      className="dpf-grid-editor"
      type="number"
      autoFocus
      value={typeof v === "number" ? v : ""}
      onChange={(e) =>
        onRowChange({
          ...row,
          [column.key]: e.target.value === "" ? null : Number(e.target.value),
        })
      }
      onBlur={() => onClose(true)}
    />
  );
}

export function makeDateEditor(withTime: boolean) {
  return function DateEditor({
    row,
    column,
    onRowChange,
    onClose,
  }: RenderEditCellProps<GridRowData>): ReactNode {
    const raw = row[column.key];
    const iso = typeof raw === "string" ? raw : null;
    const inputVal = iso ? (withTime ? iso.slice(0, 16) : iso.slice(0, 10)) : "";
    return (
      <input
        className="dpf-grid-editor"
        type={withTime ? "datetime-local" : "date"}
        autoFocus
        value={inputVal}
        onChange={(e) => {
          const val = e.target.value;
          onRowChange({
            ...row,
            [column.key]: val ? new Date(val).toISOString() : null,
          });
        }}
        onBlur={() => onClose(true)}
      />
    );
  };
}

export function makeSelectEditor(options: SelectOption[]) {
  return function SelectEditor({
    row,
    column,
    onRowChange,
    onClose,
  }: RenderEditCellProps<GridRowData>): ReactNode {
    return (
      <select
        className="dpf-grid-editor"
        autoFocus
        value={asString(row[column.key])}
        onChange={(e) =>
          onRowChange(
            { ...row, [column.key]: e.target.value === "" ? null : e.target.value },
            true,
          )
        }
        onBlur={() => onClose(true)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };
}

/**
 * Reference editor: an in-cell typeahead over a live platform entity. Searching
 * proxies through searchReferencesAction (capability-gated server-side); selecting
 * commits a ReferenceValue and closes the editor. The dropdown renders inside the
 * editor's DOM subtree, so react-data-grid does not treat a result click as an
 * outside-click that cancels the edit.
 */
export function makeReferenceEditor(referenceType: string) {
  return function ReferenceEditor({
    row,
    column,
    onRowChange,
  }: RenderEditCellProps<GridRowData>): ReactNode {
    const current = row[column.key];
    const value =
      current && typeof current === "object" && !Array.isArray(current) && "referenceId" in current
        ? {
            id: (current as ReferenceValue).referenceId,
            label: (current as ReferenceValue).label ?? (current as ReferenceValue).referenceId,
          }
        : null;
    return (
      <div className="dpf-grid-editor-reference">
        <ReferenceTypeahead
          autoFocus
          placeholder="Search…"
          value={value}
          onSearch={async (q) => {
            const res = await searchReferencesAction(referenceType, q);
            return res.ok ? res.data : [];
          }}
          onSelect={(item) => {
            onRowChange(
              { ...row, [column.key]: { referenceId: item.id, referenceType, label: item.label } },
              true,
            );
          }}
        />
      </div>
    );
  };
}

// ---------------------------------------------------------------------------
// Display renderers (renderCell)
// ---------------------------------------------------------------------------

/** Checkbox: editable inline via onRowChange (no edit-mode round-trip). */
export function makeCheckboxRenderer(editable: boolean) {
  return function CheckboxCell({
    row,
    column,
    onRowChange,
  }: RenderCellProps<GridRowData>): ReactNode {
    const checked = row[column.key] === true;
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled={!editable}
        onChange={() => onRowChange({ ...row, [column.key]: !checked })}
      />
    );
  };
}

export function renderUrlCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = asString(row[column.key]);
  if (!v) return null;
  return (
    <a className="dpf-grid-link" href={v} target="_blank" rel="noreferrer">
      {v}
    </a>
  );
}

export function renderEmailCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = asString(row[column.key]);
  if (!v) return null;
  return (
    <a className="dpf-grid-link" href={`mailto:${v}`}>
      {v}
    </a>
  );
}

export function makeSelectRenderer(options: SelectOption[]) {
  const byKey = new Map(options.map((o) => [o.key, o]));
  return function SelectCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
    const key = asString(row[column.key]);
    if (!key) return null;
    const opt = byKey.get(key);
    return <span className="dpf-grid-chip">{opt?.label ?? key}</span>;
  };
}

export function makeMultiSelectRenderer(options: SelectOption[]) {
  const byKey = new Map(options.map((o) => [o.key, o]));
  return function MultiSelectCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
    const v = row[column.key];
    const keys = Array.isArray(v) ? v : [];
    if (keys.length === 0) return null;
    return (
      <>
        {keys.map((k) => (
          <span key={k} className="dpf-grid-chip">
            {byKey.get(k)?.label ?? k}
          </span>
        ))}
      </>
    );
  };
}

export function renderDateCell(withTime: boolean) {
  return function DateCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
    const raw = row[column.key];
    if (typeof raw !== "string" || !raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return <span>{withTime ? d.toLocaleString() : d.toLocaleDateString()}</span>;
  };
}

export function renderReferenceCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = row[column.key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const ref = v as ReferenceValue;
    return <span className="dpf-grid-chip">{ref.label ?? ref.referenceId}</span>;
  }
  return null;
}

/** Read-only renderer for computed (formula/lookup) cells. */
export function renderComputedCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = row[column.key];
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return <span>{v.join(", ")}</span>;
  if (typeof v === "object" && "referenceId" in v) {
    const ref = v as ReferenceValue;
    return <span className="dpf-grid-chip">{ref.label ?? ref.referenceId}</span>;
  }
  if (typeof v === "boolean") return <span>{v ? "TRUE" : "FALSE"}</span>;
  const text = String(v);
  const isError = text.startsWith("#ERROR");
  return <span className={isError ? "dpf-grid-formula-error" : undefined}>{text}</span>;
}
