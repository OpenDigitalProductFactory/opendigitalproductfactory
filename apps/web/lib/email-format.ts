/**
 * Client-safe email normalization/validation for the portal UI.
 *
 * Pairs with {@link ./../components/ui/EmailInput}, which normalizes on blur.
 * Kept dependency-free and deliberately permissive — it mirrors HTML5 + Zod's
 * `.email()` intent (one "@", a dotted domain) without trying to fully model
 * RFC 5322. Server-side schemas (`@dpf/validators`) remain the authority for
 * rejection. NOTE: this is distinct from `lib/email.ts`, which is the
 * server-only (nodemailer) email *sender* and must not be imported by clients.
 */

// One local part, one "@", a dotted domain. Matches Zod/HTML5 practical intent.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim surrounding whitespace and lowercase. Safe to call on any input. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** True when `value` looks like a valid email (after trimming). */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 320 && EMAIL_RE.test(trimmed);
}
