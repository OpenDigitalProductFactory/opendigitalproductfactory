/**
 * Shared, framework-free validation for public storefront customer forms
 * (BI-F20763F5). Public forms previously relied on browser-native
 * `required` blocking only, which is invisible to a summary region and
 * inconsistent for assistive technology. This helper is the single, pure
 * contract used to produce *visible* inline + summary validation so the
 * feedback is deterministic and testable without a DOM.
 *
 * It is intentionally decoupled from the shared `ui/form` primitives
 * (BI-8E74C749) so a public form can adopt visible validation without a
 * compile-time dependency on that in-flight work; the two share the same
 * accessible pattern (aria-invalid + aria-describedby + a role="alert"
 * summary) rather than sharing code.
 */

export type ValidatableField = {
  name: string;
  label: string;
  type: string;
  required: boolean;
};

export type FieldErrors = Record<string, string>;

export type ValidationResult = {
  valid: boolean;
  /** Per-field message, keyed by field name — drives inline errors. */
  errors: FieldErrors;
  /** Ordered field names with errors — drives the summary region ordering. */
  order: string[];
};

// Deliberately permissive: catches the "obviously not an email" mistakes a
// customer makes (missing @, missing domain, trailing dot) without rejecting
// valid-but-unusual addresses. Server-side validation remains authoritative.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * Validate a set of field values against their schema. Returns per-field
 * messages plus a stable order so the summary lists errors in field order.
 *
 * @param fields the form schema (required flag + type drive the rules)
 * @param values raw string values keyed by field name (missing = empty)
 */
export function validateRequiredFields(
  fields: ReadonlyArray<ValidatableField>,
  values: Record<string, string | undefined | null>,
): ValidationResult {
  const errors: FieldErrors = {};
  const order: string[] = [];

  for (const field of fields) {
    const raw = values[field.name];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (field.required && value === "") {
      errors[field.name] = `${field.label} is required`;
      order.push(field.name);
      continue;
    }

    // Only format-check when a value is present; an empty optional email is fine.
    if (value !== "" && field.type === "email" && !isLikelyEmail(value)) {
      errors[field.name] = `Enter a valid email address`;
      order.push(field.name);
    }
  }

  return { valid: order.length === 0, errors, order };
}

/** Stable id for a field's inline error node, used by aria-describedby. */
export function errorId(formId: string, fieldName: string): string {
  return `${formId}-${fieldName}-error`;
}
