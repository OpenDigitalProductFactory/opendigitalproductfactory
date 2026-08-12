"use client";

// SelectField — a themed labeled <select> wired through FormField. Options are
// rendered with the required themed <option> classes (AGENTS.md §12). Pass a
// placeholder to render a disabled leading "Select…" option.

import type { ReactNode, SelectHTMLAttributes } from "react";
import { FormField } from "./FormField";
import { cx, fieldControlClass, fieldOptionClass } from "./styles";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type NativeSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "name" | "value" | "onChange" | "required" | "className"
>;

export type SelectFieldProps = {
  name: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** Leading placeholder option text (value ""). */
  placeholder?: string;
  autoComplete?: string;
  className?: string;
  selectClassName?: string;
} & NativeSelectProps;

export function SelectField({
  name,
  label,
  value,
  onValueChange,
  options,
  required = false,
  optional = false,
  hint,
  error,
  placeholder,
  autoComplete,
  className,
  selectClassName,
  ...selectProps
}: SelectFieldProps) {
  return (
    <FormField
      name={name}
      label={label}
      required={required}
      optional={optional}
      hint={hint}
      error={error}
      className={className}
    >
      {(control) => (
        <select
          {...selectProps}
          {...control}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          autoComplete={autoComplete}
          className={cx(fieldControlClass, selectClassName)}
        >
          {placeholder !== undefined ? (
            <option value="" disabled className={fieldOptionClass}>
              {placeholder}
            </option>
          ) : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled} className={fieldOptionClass}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}
