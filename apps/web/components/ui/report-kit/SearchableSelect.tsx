"use client";
// apps/web/components/ui/report-kit/SearchableSelect.tsx
//
// Canonical "pick one out of many" control for the reporting palette
// (EP-UX-COGLOAD / BI-D6135B88).
//
// WHY THIS EXISTS. A flat select element asks the reader to resolve the whole option
// set themselves: Hick's law says the decision cost grows with the number of
// choices, which is exactly what the ux-budget `choice-load` axis measures
// (lib/ux-budget/measure.ts `maxChoicesPerControl`). /platform/audit/authority
// shipped a 94-option agent select against a budget of 20 — the operator had
// to scroll a dropdown to find one agent id they already knew the name of.
//
// A searchable picker inverts that: the reader TYPES what they are looking for
// and the list narrows. The options still exist and are still reachable — this
// is not truncation — but the surface no longer pushes an unresolved 94-way
// decision at someone on arrival.
//
// Built on a native datalist element deliberately, not a hand-rolled popup:
//   - keyboard, screen-reader and mobile behaviour come from the platform;
//   - it degrades to a plain text field if the datalist is unsupported;
//   - there is no focus-trap/aria-activedescendant machinery to get wrong.
// The trade-off a datalist brings is that it does not CONSTRAIN input, so this
// component owns that: a keystroke only commits when it resolves to a real
// option, and an unresolved value is reported inline instead of silently
// selecting nothing.

import { useEffect, useId, useMemo, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

export interface SearchableSelectProps {
  /** Visible field label. Also the accessible name. */
  label: string;
  options: SearchableSelectOption[];
  /** Currently selected option value. "" when nothing is selected. */
  value: string;
  onChange: (value: string) => void;
  /** Placeholder shown when nothing is typed. Defaults to a "search" hint. */
  placeholder?: string;
  /** Rendered under the field when the option list is empty. */
  emptyLabel?: string;
  className?: string;
}

/** Case/whitespace-insensitive key used to resolve typed text to an option. */
function norm(text: string): string {
  return text.trim().toLowerCase();
}

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder,
  emptyLabel = "No options available",
  className = "",
}: SearchableSelectProps) {
  const reactId = useId();
  const inputId = `${reactId}-input`;
  const listId = `${reactId}-list`;
  const statusId = `${reactId}-status`;

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  // Local text so the reader can type freely; the committed selection only
  // moves when the text resolves. Re-sync when the selection changes from
  // outside (e.g. the agent changed, so the route list reset).
  const [text, setText] = useState(selected?.label ?? "");
  useEffect(() => {
    setText(selected?.label ?? "");
  }, [selected]);

  // Labels are the datalist's option values, so resolution is label-first;
  // falling back to the raw option value lets someone paste an id directly.
  const byLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of options) {
      map.set(norm(option.label), option.value);
      map.set(norm(option.value), option.value);
    }
    return map;
  }, [options]);

  const resolved = byLabel.get(norm(text));
  const unresolved = text.trim().length > 0 && resolved === undefined;

  const commit = (next: string) => {
    setText(next);
    const match = byLabel.get(norm(next));
    if (match !== undefined && match !== value) onChange(match);
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={inputId}
        className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--dpf-muted)]"
      >
        {label}
      </label>
      <input
        id={inputId}
        list={listId}
        type="text"
        role="combobox"
        aria-expanded="false"
        aria-controls={listId}
        aria-describedby={statusId}
        autoComplete="off"
        value={text}
        placeholder={placeholder ?? `Search ${options.length}…`}
        onChange={(event) => commit(event.target.value)}
        // Leaving the field with unresolved text would strand the reader on a
        // value the surface is not actually using; snap back to the selection.
        onBlur={() => setText(selected?.label ?? "")}
        className="min-w-[13rem] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.label} />
        ))}
      </datalist>
      {/* Always rendered (never conditional) so assistive tech announces the
          change rather than a region appearing and disappearing. */}
      <span id={statusId} role="status" className="text-[11px] text-[var(--dpf-muted)]">
        {options.length === 0
          ? emptyLabel
          : unresolved
            ? `No match — showing ${selected?.label ?? "nothing"}`
            : `${options.length} available`}
      </span>
    </div>
  );
}
