"use client";

import { forwardRef, useCallback } from "react";
import type { ChangeEvent, FocusEvent, InputHTMLAttributes } from "react";

import { isValidEmail, normalizeEmail } from "@/lib/email-format";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> & {
  /** Provide for a controlled field. Omit (use `defaultValue`/`name`) for an uncontrolled one. */
  value?: string;
  /** Receives every keystroke (and the normalized value on blur) for controlled use. */
  onValueChange?: (value: string) => void;
  /** Trim + lowercase on blur. Default true. */
  normalizeOnBlur?: boolean;
  /** Fired on blur with whether the (normalized) value is valid or empty. */
  onValidityChange?: (valid: boolean) => void;
};

/**
 * A drop-in `<input type="email">` that normalizes the address (trim +
 * lowercase) when the field loses focus — the least-surprising moment, so it
 * never fights the user mid-keystroke — and reports validity. Live typing is
 * untouched; storage gets a clean, canonical value.
 *
 * Works controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`/
 * `name`, e.g. FormData forms) — in the uncontrolled case the normalized value
 * is written back to the field so the submitted value is clean.
 */
export const EmailInput = forwardRef<HTMLInputElement, Props>(function EmailInput(
  {
    value,
    onValueChange,
    normalizeOnBlur = true,
    onValidityChange,
    onBlur,
    inputMode,
    autoComplete,
    ...rest
  },
  ref,
) {
  const controlled = value !== undefined;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onValueChange?.(e.target.value);
    },
    [onValueChange],
  );

  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const next = normalizeOnBlur ? normalizeEmail(raw) : raw;
      if (next !== raw) {
        if (controlled) onValueChange?.(next);
        else e.currentTarget.value = next;
      }
      if (!controlled) onValueChange?.(next);
      onValidityChange?.(next === "" || isValidEmail(next));
      onBlur?.(e);
    },
    [controlled, normalizeOnBlur, onValueChange, onValidityChange, onBlur],
  );

  return (
    <input
      ref={ref}
      type="email"
      inputMode={inputMode ?? "email"}
      autoComplete={autoComplete ?? "email"}
      {...(controlled ? { value } : {})}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

export default EmailInput;
