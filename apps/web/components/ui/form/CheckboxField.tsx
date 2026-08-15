"use client";

// CheckboxField — a labeled checkbox whose caption sits to the right of the box
// (the conventional layout), with an optional hint and consequence-aware error.
// Wiring mirrors FormField: htmlFor/id, aria-describedby, role="alert" error.

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx, fieldErrorClass, fieldHintClass } from "./styles";

type NativeCheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "name" | "type" | "checked" | "onChange" | "disabled" | "className"
>;

export type CheckboxFieldProps = {
  name: string;
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
} & NativeCheckboxProps;

export function CheckboxField({
  name,
  label,
  checked,
  onCheckedChange,
  hint,
  error,
  disabled,
  className,
  ...inputProps
}: CheckboxFieldProps) {
  const uid = useId();
  const id = `${uid}-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <div className="flex items-start gap-2">
        <input
          {...inputProps}
          id={id}
          name={name}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        />
        <label htmlFor={id} className="text-sm text-[var(--dpf-text)]">
          {label}
        </label>
      </div>
      {hint ? (
        <p id={hintId} className={cx(fieldHintClass, "ml-6")}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className={cx(fieldErrorClass, "ml-6")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
