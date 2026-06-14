"use client";

// Universal Grid & Workbooks — cell editors + display renderers (EP-GRID-WORKBOOKS)
// Factories that produce react-data-grid renderEditCell / renderCell functions
// bound to a column's field config. Keeps Grid.tsx declarative.

import type { ReactNode } from "react";
import type { RenderEditCellProps, RenderCellProps } from "react-data-grid";
import type { CellValue, SelectOption, ReferenceValue, AttachmentValue } from "@/lib/workbooks/types";
import { ReferenceTypeahead } from "@/components/ui/ReferenceTypeahead";
import { searchReferencesAction } from "@/lib/actions/workbooks";

/** Flat row shape react-data-grid consumes: rowId + a value per columnId. */
export type GridRowData = { rowId: string } & Record<string, CellValue>;

function asString(v: CellValue): string {
  return typeof v === "string" ? v : "";
}

function asAttachment(v: CellValue): AttachmentValue | null {
  return v && typeof v === "object" && "url" in v && typeof v.url === "string"
    ? (v as AttachmentValue)
    : null;
}

/** Human-readable byte size, e.g. 2.4 MB / 812 KB / 96 B. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
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

/**
 * Image editor: uploads a chosen file to /api/v1/upload (content-addressed
 * MediaAsset storage) and commits the returned retrieval URL as the cell value.
 * The bytes never live in the cell — only the URL string does, so an image
 * column behaves like a url column with an upload affordance + thumbnail render.
 */
export function ImageEditor({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellProps<GridRowData>): ReactNode {
  const current = asString(row[column.key]);
  return (
    <div className="dpf-grid-editor-image">
      <input
        type="file"
        accept="image/*"
        autoFocus
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) {
            onClose(false);
            return;
          }
          const body = new FormData();
          body.append("file", file);
          try {
            const res = await fetch("/api/v1/upload", { method: "POST", body });
            const json = (await res.json()) as { data?: { url?: string }; url?: string };
            const url = json.data?.url ?? json.url ?? null;
            if (url) {
              onRowChange({ ...row, [column.key]: url }, true);
            } else {
              onClose(false);
            }
          } catch {
            onClose(false);
          }
        }}
      />
      {current ? (
        <button
          type="button"
          className="dpf-grid-image-clear"
          onClick={() => onRowChange({ ...row, [column.key]: null }, true)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

/**
 * Attachment editor: uploads any file type to /api/v1/upload (content-addressed
 * MediaAsset storage) and commits an {url, name, size} value. Unlike the image
 * editor it accepts any file and preserves the original filename + size for a
 * download chip (the upload endpoint echoes only the URL, so name/size are
 * captured client-side from the chosen File).
 */
export function AttachmentEditor({
  row,
  column,
  onRowChange,
  onClose,
}: RenderEditCellProps<GridRowData>): ReactNode {
  const current = asAttachment(row[column.key]);
  return (
    <div className="dpf-grid-editor-image">
      <input
        type="file"
        autoFocus
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) {
            onClose(false);
            return;
          }
          const body = new FormData();
          body.append("file", file);
          try {
            const res = await fetch("/api/v1/upload", { method: "POST", body });
            const json = (await res.json()) as { data?: { url?: string }; url?: string };
            const url = json.data?.url ?? json.url ?? null;
            if (url) {
              onRowChange(
                { ...row, [column.key]: { url, name: file.name, size: file.size } },
                true,
              );
            } else {
              onClose(false);
            }
          } catch {
            onClose(false);
          }
        }}
      />
      {current ? (
        <button
          type="button"
          className="dpf-grid-image-clear"
          onClick={() => onRowChange({ ...row, [column.key]: null }, true)}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
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

export function renderImageCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = asString(row[column.key]);
  if (!v) return null;
  // eslint-disable-next-line @next/next/no-img-element -- content-addressed media URL, arbitrary host; next/image optimizer not applicable
  return <img className="dpf-grid-thumb" src={v} alt="" />;
}

export function renderAttachmentCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const att = asAttachment(row[column.key]);
  if (!att) return null;
  const label = att.name ?? att.url.split("/").pop() ?? "file";
  return (
    <a className="dpf-grid-attachment" href={att.url} target="_blank" rel="noreferrer" download={att.name}>
      <span className="dpf-grid-attachment-name">{label}</span>
      {typeof att.size === "number" ? (
        <span className="dpf-grid-attachment-size">{formatBytes(att.size)}</span>
      ) : null}
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
    const keys: string[] = Array.isArray(v) ? v.filter((it): it is string => typeof it === "string") : [];
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

/** Read-only renderer for `link` cells — a chip per linked record. */
export function renderLinkCell({ row, column }: RenderCellProps<GridRowData>): ReactNode {
  const v = row[column.key];
  if (!Array.isArray(v) || v.length === 0) return null;
  const refs = v.filter((it): it is ReferenceValue => !!it && typeof it === "object" && "referenceId" in it);
  if (refs.length === 0) return null;
  return (
    <span className="dpf-grid-chips">
      {refs.map((ref) => (
        <span key={ref.referenceId} className="dpf-grid-chip">
          {ref.label ?? ref.referenceId}
        </span>
      ))}
    </span>
  );
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
