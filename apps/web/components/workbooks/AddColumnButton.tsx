"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addColumnAction, listReferenceTargetsAction } from "@/lib/actions/workbooks";
import type { ReferenceTarget } from "@/lib/workbooks/platform-tables";
import type { FieldType, SelectOption, FieldConfig } from "@/lib/workbooks/types";

// Field types with a fully-functional in-grid editor.
// multi_select exists in the data model but is not offered here yet (rendered
// read-only; tracked under EP-GRID-WORKBOOKS).
const OFFERED_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "checkbox", label: "Checkbox" },
  { value: "select", label: "Single select" },
  { value: "reference", label: "Reference" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
];

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseOptions(raw: string): SelectOption[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ key: slugify(label) || label, label }));
}

export function AddColumnButton({
  workbookId,
  tableId,
}: {
  workbookId: string;
  tableId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [optionsRaw, setOptionsRaw] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [referenceTargets, setReferenceTargets] = useState<ReferenceTarget[]>([]);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Load the available reference targets once the picker is opened.
  useEffect(() => {
    if (!open || referenceTargets.length > 0) return;
    let active = true;
    void listReferenceTargetsAction().then((res) => {
      if (active && res.ok) setReferenceTargets(res.data);
    });
    return () => {
      active = false;
    };
  }, [open, referenceTargets.length]);

  function reset() {
    setOpen(false);
    setName("");
    setFieldType("text");
    setOptionsRaw("");
    setReferenceType("");
    setRequired(false);
    setError(null);
  }

  function buildConfig(): FieldConfig | undefined {
    if (fieldType === "select") return { options: parseOptions(optionsRaw) };
    if (fieldType === "reference") return { referenceType };
    return undefined;
  }

  const missingReferenceTarget = fieldType === "reference" && !referenceType;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addColumnAction(workbookId, tableId, {
        name: name.trim(),
        fieldType,
        required,
        config: buildConfig(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      >
        + Add column
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Column name"
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      />
      <select
        value={fieldType}
        onChange={(e) => setFieldType(e.target.value as FieldType)}
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      >
        {OFFERED_TYPES.map((t) => (
          <option key={t.value} value={t.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            {t.label}
          </option>
        ))}
      </select>
      {fieldType === "select" && (
        <input
          value={optionsRaw}
          onChange={(e) => setOptionsRaw(e.target.value)}
          placeholder="Options (comma-separated)"
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        />
      )}
      {fieldType === "reference" && (
        <select
          value={referenceType}
          onChange={(e) => setReferenceType(e.target.value)}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
        >
          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
            {referenceTargets.length === 0 ? "No reference targets available" : "Select what to reference…"}
          </option>
          {referenceTargets.map((t) => (
            <option
              key={t.entityType}
              value={t.entityType}
              className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
            >
              {t.label}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-center gap-1 text-sm text-[var(--dpf-muted)]">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim() || missingReferenceTarget}
        className="rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-sm text-[var(--dpf-text)]"
      >
        Cancel
      </button>
      {error && <span className="text-sm text-[var(--dpf-error)]">{error}</span>}
    </div>
  );
}
