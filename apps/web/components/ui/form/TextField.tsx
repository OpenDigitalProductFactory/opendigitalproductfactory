"use client";

// TextField — a single-line labeled input wired through FormField. Covers the
// everyday text-ish types (text/tel/password/number/date/time/url/search). For
// email prefer EmailField (it also normalizes on blur); for a themed dropdown
// use SelectField.

import type { InputHTMLAttributes, ReactNode } from "react";
import { FormField } from "./FormField";
import { cx, fieldControlClass } from "./styles";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "name" | "value" | "onChange" | "required" | "type"
>;

export type TextFieldProps = {
  name: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  type?: "text" | "tel" | "password" | "number" | "date" | "time" | "url" | "search";
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /**
   * The autocomplete token. Required by lint intent for auth fields — pass
   * "current-password" / "new-password" for passwords, "username"/"email" for
   * identifiers, "name", "tel", etc. Pass "off" only with a reason.
   */
  autoComplete?: string;
  className?: string;
  inputClassName?: string;
} & NativeInputProps;

export function TextField({
  name,
  label,
  value,
  onValueChange,
  type = "text",
  required = false,
  optional = false,
  hint,
  error,
  autoComplete,
  className,
  inputClassName,
  ...inputProps
}: TextFieldProps) {
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
        <input
          {...inputProps}
          {...control}
          type={type}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          autoComplete={autoComplete}
          className={cx(fieldControlClass, inputClassName)}
        />
      )}
    </FormField>
  );
}
