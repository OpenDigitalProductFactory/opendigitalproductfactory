"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addColumnAction,
  listReferenceTargetsAction,
  getReferenceTargetFieldsAction,
} from "@/lib/actions/workbooks";
import type { ReferenceTarget, ReferenceFieldOption } from "@/lib/workbooks/platform-tables";
import type { FieldType, SelectOption, FieldConfig, ColumnDefinition } from "@/lib/workbooks/types";

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
  { value: "lookup", label: "Lookup (from a reference)" },
  { value: "formula", label: "Formula" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "image", label: "Image" },
  { value: "attachment", label: "Attachment" },
];

const RESULT_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
];

const inputClass =
  "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-sm text-[var(--dpf-text)]";
const selectClass =
  "rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm text-[var(--dpf-text)]";
const optionClass = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";

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
  columns = [],
}: {
  workbookId: string;
  tableId: string;
  columns?: ColumnDefinition[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [optionsRaw, setOptionsRaw] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [referenceTargets, setReferenceTargets] = useState<ReferenceTarget[]>([]);
  const [formula, setFormula] = useState("");
  const [resultType, setResultType] = useState<FieldType>("text");
  const [lookupRefColumnId, setLookupRefColumnId] = useState("");
  const [lookupTargetField, setLookupTargetField] = useState("");
  const [targetFields, setTargetFields] = useState<ReferenceFieldOption[]>([]);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reference columns on this table are the only valid lookup sources.
  const referenceColumns = columns.filter((c) => c.fieldType === "reference");
  const selectedRefColumn = referenceColumns.find((c) => c.columnId === lookupRefColumnId);

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

  // When a lookup's source reference column changes, load that entity's fields.
  useEffect(() => {
    const refType = selectedRefColumn?.config?.referenceType;
    if (fieldType !== "lookup" || !refType) {
      setTargetFields([]);
      return;
    }
    let active = true;
    void getReferenceTargetFieldsAction(refType).then((res) => {
      if (active && res.ok) setTargetFields(res.data);
    });
    return () => {
      active = false;
    };
  }, [fieldType, selectedRefColumn?.config?.referenceType]);

  function reset() {
    setOpen(false);
    setName("");
    setFieldType("text");
    setOptionsRaw("");
    setReferenceType("");
    setFormula("");
    setResultType("text");
    setLookupRefColumnId("");
    setLookupTargetField("");
    setTargetFields([]);
    setRequired(false);
    setError(null);
  }

  function buildConfig(): FieldConfig | undefined {
    if (fieldType === "select") return { options: parseOptions(optionsRaw) };
    if (fieldType === "reference") return { referenceType };
    if (fieldType === "formula") return { formula, resultType };
    if (fieldType === "lookup") {
      return { lookup: { referenceColumnId: lookupRefColumnId, targetField: lookupTargetField } };
    }
    return undefined;
  }

  const missingReferenceTarget = fieldType === "reference" && !referenceType;
  const missingFormula = fieldType === "formula" && !formula.trim();
  const missingLookup = fieldType === "lookup" && (!lookupRefColumnId || !lookupTargetField);
  const invalidConfig = missingReferenceTarget || missingFormula || missingLookup;

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
          className={selectClass}
        >
          <option value="" className={optionClass}>
            {referenceTargets.length === 0 ? "No reference targets available" : "Select what to reference…"}
          </option>
          {referenceTargets.map((t) => (
            <option key={t.entityType} value={t.entityType} className={optionClass}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      {fieldType === "formula" && (
        <>
          <input
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder='Formula, e.g. =IF(Priority>3,"high","low")'
            className={`${inputClass} min-w-[20rem]`}
          />
          <select
            value={resultType}
            onChange={(e) => setResultType(e.target.value as FieldType)}
            className={selectClass}
            aria-label="Result type"
          >
            {RESULT_TYPES.map((t) => (
              <option key={t.value} value={t.value} className={optionClass}>
                {t.label}
              </option>
            ))}
          </select>
        </>
      )}
      {fieldType === "lookup" && (
        <>
          <select
            value={lookupRefColumnId}
            onChange={(e) => {
              setLookupRefColumnId(e.target.value);
              setLookupTargetField("");
            }}
            className={selectClass}
            aria-label="Reference column"
          >
            <option value="" className={optionClass}>
              {referenceColumns.length === 0 ? "Add a reference column first" : "From reference column…"}
            </option>
            {referenceColumns.map((c) => (
              <option key={c.columnId} value={c.columnId} className={optionClass}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={lookupTargetField}
            onChange={(e) => setLookupTargetField(e.target.value)}
            className={selectClass}
            aria-label="Target field"
            disabled={!lookupRefColumnId}
          >
            <option value="" className={optionClass}>
              {!lookupRefColumnId
                ? "Pick a reference column first"
                : targetFields.length === 0
                  ? "No fields available"
                  : "Field to pull…"}
            </option>
            {targetFields.map((f) => (
              <option key={f.field} value={f.field} className={optionClass}>
                {f.name}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="flex items-center gap-1 text-sm text-[var(--dpf-muted)]">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim() || invalidConfig}
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
