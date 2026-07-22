/**
 * Pure, framework-agnostic required-field validation for public storefront
 * forms (BI-F20763F5). Kept free of React / I/O so it is deterministic and
 * side-effect-free: the same `(fields, values)` always yields the same errors,
 * with no network, DB, or payment interaction. This is the single source of the
 * customer-facing validation contract shared by the inquiry form and exercised
 * — as data, not via the sibling components — for the auth (email/password) and
 * booking (name/email/date/time) field sets.
 */

/** Minimal field shape the validator needs. `@dpf/storefront-templates`'
 *  `FormField` structurally satisfies this, as do ad-hoc auth/booking specs. */
export interface ValidatableField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

export type FieldValues = Record<string, string | null | undefined>;
export type FieldErrors = Record<string, string>;

// Deliberately conservative: one @, at least one dot in the domain, no spaces.
// The server is the authority on deliverability; this only catches obvious typos
// so the customer gets a friendly nudge instead of a silent failure.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requiredMessage(label: string): string {
  return `${label} is required`;
}

export const INVALID_EMAIL_MESSAGE = "Enter a valid email address";

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/**
 * Validate a set of fields against submitted values. Returns a map of
 * field-name → human-readable message for every field that fails. An empty
 * object means the form is valid.
 *
 * Rules:
 * - required field left blank → `"<Label> is required"`
 * - email-typed field with a non-blank but malformed value → invalid-email
 *   message (a blank optional email is not flagged)
 */
export function validateRequiredFields(
  fields: ReadonlyArray<ValidatableField>,
  values: FieldValues,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (field.required && isBlank(raw)) {
      errors[field.name] = requiredMessage(field.label);
      continue;
    }
    if (field.type === "email" && !isBlank(raw) && !EMAIL_RE.test(raw!.trim())) {
      errors[field.name] = INVALID_EMAIL_MESSAGE;
    }
  }
  return errors;
}

/** True when the field set validates cleanly against the given values. */
export function isFormValid(
  fields: ReadonlyArray<ValidatableField>,
  values: FieldValues,
): boolean {
  return Object.keys(validateRequiredFields(fields, values)).length === 0;
}

/**
 * Ordered [name, message] pairs for building an error summary that follows the
 * field order the customer sees, rather than object-key order.
 */
export function orderedErrors(
  fields: ReadonlyArray<ValidatableField>,
  errors: FieldErrors,
): Array<{ name: string; message: string }> {
  return fields
    .filter((f) => errors[f.name])
    .map((f) => ({ name: f.name, message: errors[f.name] }));
}
