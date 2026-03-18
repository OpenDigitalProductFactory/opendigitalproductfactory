"use client";

import { useState, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import {
  useFloating,
  useClick,
  useDismiss,
  useInteractions,
  offset,
  flip,
  shift,
} from "@floating-ui/react";

type DatePickerProps = {
  value?: Date | null;
  onChange: (date: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
};

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    middleware: [offset(4), flip(), shift({ padding: 8 })],
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ]);

  const handleSelect = useCallback(
    (selected: Date | undefined) => {
      onChange(selected ?? null);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="relative">
      <input
        ref={refs.setReference}
        type="text"
        readOnly
        disabled={disabled}
        value={value ? formatDate(value) : ""}
        placeholder={placeholder}
        className="w-full rounded border px-3 py-2 text-sm bg-[var(--dpf-surface-2)] border-[var(--dpf-border)] text-[var(--dpf-foreground)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
        {...getReferenceProps()}
      />
      {open && (
        <div
          ref={refs.setFloating}
          role="dialog"
          style={floatingStyles}
          className="z-50 rounded border bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] p-2 shadow-lg"
          {...getFloatingProps()}
        >
          <DayPicker
            mode="single"
            selected={value ?? undefined}
            onSelect={handleSelect}
            {...(value ? { defaultMonth: value } : {})}
            style={
              {
                "--rdp-accent-color": "var(--dpf-accent)",
                "--rdp-accent-background-color": "var(--dpf-surface-2)",
              } as React.CSSProperties
            }
            classNames={{
              root: "text-[var(--dpf-foreground)]",
              day: "text-sm rounded hover:bg-[var(--dpf-surface-2)]",
              selected:
                "bg-[var(--dpf-accent)] text-white hover:bg-[var(--dpf-accent)]",
              today: "font-bold",
              chevron: "fill-[var(--dpf-muted)]",
            }}
          />
        </div>
      )}
    </div>
  );
}
