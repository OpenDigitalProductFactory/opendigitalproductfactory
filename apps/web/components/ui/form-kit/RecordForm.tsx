"use client";

// Platform form-kit — record editing form (EP-UX-SYSTEM, BI-C167C45E).
// Spec: docs/superpowers/specs/2026-07-28-platform-forms-framework-design.md
//
// The one record-form composition every surface reuses: label/control rows from
// FormFieldSpec metadata, drafts held in the form-state kernel (nothing commits
// on blur), one explicit Save/Discard bar that appears only when dirty, and a
// disclosure section for fields the current layout hides. The host owns
// persistence (onSave receives only the dirty subset) and read-only rendering
// of its own complex value kinds.

import { useMemo, useState, type ReactNode } from "react";
import {
  dirtyValues,
  committed,
  discarded,
  initFormState,
  isFormDirty,
  withFieldEdit,
  type FormValues,
} from "@/lib/form-kit/form-state";
import {
  inputTypeFor,
  resolveControlKind,
  type FormFieldSpec,
} from "@/lib/form-kit/field-controls";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

export interface RecordFormProps {
  /** Fields shown by default, in layout order. */
  fields: FormFieldSpec[];
  /** Fields the current layout hides — reachable behind a disclosure, not lost. */
  hiddenFields?: FormFieldSpec[];
  /** The record's current values keyed by fieldId. */
  values: FormValues;
  /** Persist the dirty subset. Called only from the explicit Save action. */
  onSave: (dirty: FormValues) => void | Promise<void>;
  /** Dirty-state signal for the host (e.g. close guards). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Host renders its own read-only value kinds (references, attachments, …). */
  renderReadOnly: (field: FormFieldSpec, value: unknown) => ReactNode;
}

function asStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

const ctrl =
  "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]";

export function RecordForm({
  fields,
  hiddenFields = [],
  values,
  onSave,
  onDirtyChange,
  renderReadOnly,
}: RecordFormProps) {
  const [state, setState] = useState(() => initFormState(values));
  const [saving, setSaving] = useState(false);
  const dirty = isFormDirty(state);

  const edit = (fieldId: string, value: unknown) => {
    setState((s) => {
      const next = withFieldEdit(s, fieldId, value);
      onDirtyChange?.(isFormDirty(next));
      return next;
    });
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave(dirtyValues(state));
      setState((s) => committed(s));
      onDirtyChange?.(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setState((s) => discarded(s));
    onDirtyChange?.(false);
  };

  const control = (field: FormFieldSpec) => {
    const kind = resolveControlKind(field);
    const value = state.draft[field.fieldId] ?? null;

    switch (kind) {
      case "readonly":
        return renderReadOnly(field, value);
      case "longtext":
        return (
          <AutoGrowTextarea
            value={asStr(value)}
            onValueChange={(v) => edit(field.fieldId, v === "" ? null : v)}
            ariaLabel={field.label}
          />
        );
      case "text":
        return (
          <input
            type={inputTypeFor(field.fieldType)}
            className={ctrl}
            value={asStr(value)}
            onChange={(e) => edit(field.fieldId, e.target.value === "" ? null : e.target.value)}
            aria-label={field.label}
          />
        );
      case "number":
        return (
          <input
            type="number"
            className={ctrl}
            value={asStr(value)}
            onChange={(e) =>
              edit(field.fieldId, e.target.value === "" ? null : Number(e.target.value))
            }
            aria-label={field.label}
          />
        );
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => edit(field.fieldId, e.target.checked)}
            aria-label={field.label}
          />
        );
      case "select":
        return (
          <select
            className={ctrl}
            value={asStr(value)}
            onChange={(e) => edit(field.fieldId, e.target.value === "" ? null : e.target.value)}
            aria-label={field.label}
          >
            <option value="">—</option>
            {(field.options ?? []).map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case "date":
      case "datetime":
        return (
          <input
            type={kind === "datetime" ? "datetime-local" : "date"}
            className={ctrl}
            value={asStr(value).slice(0, kind === "datetime" ? 16 : 10)}
            onChange={(e) => edit(field.fieldId, e.target.value === "" ? null : e.target.value)}
            aria-label={field.label}
          />
        );
    }
  };

  const row = (field: FormFieldSpec) => (
    <div key={field.fieldId} className="dpf-record-modal-row">
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
        {field.label}
      </dt>
      <dd>{control(field)}</dd>
    </div>
  );

  const hiddenLabel = useMemo(
    () =>
      hiddenFields.length === 1 ? "1 hidden field" : `${hiddenFields.length} hidden fields`,
    [hiddenFields.length],
  );

  return (
    <div>
      <dl className="dpf-record-modal-body">
        {fields.map(row)}
        {hiddenFields.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
              {hiddenLabel}
            </summary>
            <div className="mt-3 flex flex-col gap-3">{hiddenFields.map(row)}</div>
          </details>
        )}
      </dl>
      {dirty && (
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
          <span className="text-xs text-[var(--dpf-muted)]">Unsaved changes</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)]"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-on-accent)] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
