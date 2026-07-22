"use client";

// EmailField — FormField + the EmailInput primitive, so the address is
// normalized on blur AND the label/required/error wiring is consistent with
// every other field. Defaults autoComplete to "email"; pass "username" on a
// sign-in form where the email is the account identifier if you prefer.

import type { ReactNode } from "react";
import { EmailInput } from "@/components/ui/EmailInput";
import { FormField } from "./FormField";
import { cx, fieldControlClass } from "./styles";

export type EmailFieldProps = {
  name: string;
  label: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  autoComplete?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
};

export function EmailField({
  name,
  label,
  value,
  onValueChange,
  required = false,
  optional = false,
  hint,
  error,
  autoComplete = "email",
  placeholder,
  className,
  inputClassName,
  autoFocus,
}: EmailFieldProps) {
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
        <EmailInput
          {...control}
          value={value}
          onValueChange={onValueChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cx(fieldControlClass, inputClassName)}
        />
      )}
    </FormField>
  );
}
