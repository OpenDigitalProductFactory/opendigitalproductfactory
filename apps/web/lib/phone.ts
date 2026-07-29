/**
 * Shared phone-number formatting/validation for the portal UI.
 *
 * Backed by libphonenumber-js. Inputs are formatted *as the user types*
 * (see {@link ./../components/ui/PhoneInput}) and can be normalized to E.164
 * for storage/matching. Formatting is country-aware; callers should pass the
 * install's / record's country when known, otherwise {@link DEFAULT_PHONE_COUNTRY}
 * is used.
 */
import {
  AsYouType,
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  isSupportedCountry,
  type CountryCode,
} from "libphonenumber-js";

export type { CountryCode };

/** Fallback country when a form has no country context. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "US";

/**
 * Coerce a stored country string (e.g. an install's `homeCountryCode`) to a
 * libphonenumber-supported ISO-2 `CountryCode`, or null if unset/unrecognized.
 * Pure — safe to import from client or server.
 */
export function coercePhoneCountry(
  value: string | null | undefined,
): CountryCode | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return isSupportedCountry(upper) ? (upper as CountryCode) : null;
}

/**
 * Format partial input progressively (e.g. "4155551" -> "(415) 555-1"). A
 * leading "+" is honored for international numbers regardless of `country`.
 */
export function formatPhoneAsYouType(
  input: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  if (!input) return "";
  return new AsYouType(country).input(input);
}

/** Normalize to E.164 ("+14155551234") if the value is a valid number, else null. */
export function toE164(
  value: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = parsePhoneNumberFromString(value, country);
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

/** True when `value` is a complete, valid phone number for `country`. */
export function isValidPhone(
  value: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): boolean {
  if (!value?.trim()) return false;
  try {
    return isValidPhoneNumber(value, country);
  } catch {
    return false;
  }
}

/**
 * Strip the as-you-type mask from a number that is NOT valid for `country`,
 * returning just the digits (with any leading "+" preserved). A partial or
 * local-style entry like "555-0142" would otherwise be presented as an
 * authoritative-looking "(555) 014-2" — a wrong grouping the guest never
 * typed. Valid numbers pass through unchanged. Pure. (BI-7639D394)
 */
export function unmaskInvalidPhone(
  value: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (isValidPhone(trimmed, country)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/**
 * Format a stored number for display (national format for in-country numbers,
 * international when a country code is present). Returns the input unchanged if
 * it cannot be parsed, so it is safe on legacy/free-form data.
 */
export function formatPhoneDisplay(
  value: string | null | undefined,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  if (!value?.trim()) return "";
  try {
    const parsed = parsePhoneNumberFromString(value, country);
    if (!parsed) return value;
    return parsed.country ? parsed.formatNational() : parsed.formatInternational();
  } catch {
    return value;
  }
}
