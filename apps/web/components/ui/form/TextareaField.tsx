"use client";

// TextareaField — a multi-line labeled control wired through FormField.

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { FormField } from "./FormField";
import { cx, fieldControlClass } from "./styles";

type NativeTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "name" | "value" | "onChange" | "required"
>;

export type TextareaFieldProps = {
  name: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  rows?: number;
  placeholder?: string;
  className?: string;
  textareaClassName?: string;
} & NativeTextareaProps;

export function TextareaField({
  name,
  label,
  value,
  onValueChange,
  required = false,
  optional = false,
  hint,
  error,
  rows = 3,
  placeholder,
  className,
  textareaClassName,
  ...textareaProps
}: TextareaFieldProps) {
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
        <textarea
          {...textareaProps}
          {...control}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className={cx(fieldControlClass, "resize-y", textareaClassName)}
        />
      )}
    </FormField>
  );
}
