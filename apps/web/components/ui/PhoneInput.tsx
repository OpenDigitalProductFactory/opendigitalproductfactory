"use client";

import { forwardRef, useCallback } from "react";
import type { ChangeEvent, FocusEvent, InputHTMLAttributes } from "react";

import {
  formatPhoneAsYouType,
  isValidPhone,
  toE164,
  unmaskInvalidPhone,
  type CountryCode,
} from "@/lib/phone";
import { usePhoneCountry } from "@/components/ui/PhoneCountryContext";

export type PhoneChangeInfo = {
  /** The formatted value shown in the field. */
  value: string;
  /** E.164 normalization ("+14155551234") when the number is valid, else null. */
  e164: string | null;
  /** Whether the value is a complete, valid number for `country`. */
  isValid: boolean;
  country: CountryCode;
};

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onBlur"
> & {
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  /** Provide for a controlled field. Omit (use `defaultValue`/`name`) for an uncontrolled one. */
  value?: string;
  /** Receives the value formatted as-you-type. Store this. */
  onValueChange?: (value: string) => void;
  /**
   * Country to format national numbers for. Defaults to the install's home
   * country from {@link PhoneCountryProvider} (falling back to
   * {@link DEFAULT_PHONE_COUNTRY} when no provider is present).
   */
  country?: CountryCode;
  /** Optional richer callback with E.164 + validity, fired alongside onValueChange. */
  onPhoneChange?: (info: PhoneChangeInfo) => void;
};

/**
 * A drop-in `<input type="tel">` that formats the number live as the user
 * types (e.g. "4155551234" -> "(415) 555-1234"), country-aware via
 * libphonenumber-js. Reformats from scratch on every keystroke, so end-of-field
 * editing/backspace behaves naturally. Pass `country` (the install's / record's
 * ISO-2 code) when known for correct national formatting.
 *
 * Works controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`/
 * `name`, e.g. FormData forms) — in the uncontrolled case the formatted value is
 * written back to the field so the submitted value is formatted too.
 */
export const PhoneInput = forwardRef<HTMLInputElement, Props>(function PhoneInput(
  {
    value,
    onValueChange,
    country,
    onPhoneChange,
    inputMode,
    autoComplete,
    onBlur,
    ...rest
  },
  ref,
) {
  const contextCountry = usePhoneCountry();
  const resolvedCountry = country ?? contextCountry;
  const controlled = value !== undefined;

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const formatted = formatPhoneAsYouType(e.target.value, resolvedCountry);
      if (controlled) {
        onValueChange?.(formatted);
      } else {
        e.currentTarget.value = formatted;
        onValueChange?.(formatted);
      }
      onPhoneChange?.({
        value: formatted,
        e164: toE164(formatted, resolvedCountry),
        isValid: isValidPhone(formatted, resolvedCountry),
        country: resolvedCountry,
      });
    },
    [controlled, resolvedCountry, onValueChange, onPhoneChange],
  );

  // On leaving the field, drop the mask from a number that never became valid:
  // "555-0142" must not survive as the authoritative-looking "(555) 014-2"
  // the guest never typed (BI-7639D394). Valid numbers keep their format.
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLInputElement>) => {
      const current = e.currentTarget.value;
      const unmasked = unmaskInvalidPhone(current, resolvedCountry);
      if (unmasked !== current) {
        if (controlled) {
          onValueChange?.(unmasked);
        } else {
          e.currentTarget.value = unmasked;
          onValueChange?.(unmasked);
        }
        onPhoneChange?.({
          value: unmasked,
          e164: toE164(unmasked, resolvedCountry),
          isValid: isValidPhone(unmasked, resolvedCountry),
          country: resolvedCountry,
        });
      }
      onBlur?.(e);
    },
    [controlled, resolvedCountry, onValueChange, onPhoneChange, onBlur],
  );

  return (
    <input
      ref={ref}
      type="tel"
      inputMode={inputMode ?? "tel"}
      autoComplete={autoComplete ?? "tel"}
      {...(controlled ? { value } : {})}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

export default PhoneInput;
