// Shared, theme-aware class strings for the portal form contract (BI-8E74C749).
// All colors resolve through the --dpf-* custom properties (AGENTS.md §12) so
// light mode, dark mode, and branding all work automatically. Keep control
// styling in one place so every user-facing form looks and focuses identically.

/** The standard text/select/textarea control surface. */
export const fieldControlClass =
  "w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] " +
  "px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] " +
  "focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] " +
  "aria-[invalid=true]:border-[var(--dpf-error)]";

/** <option> elements need explicit themed colors (AGENTS.md §12). */
export const fieldOptionClass = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";

/** Field label text. */
export const fieldLabelClass = "text-sm font-medium text-[var(--dpf-text)]";

/** Small helper/hint text beneath a control. */
export const fieldHintClass = "text-xs text-[var(--dpf-muted)]";

/** Inline validation / error text. */
export const fieldErrorClass = "text-xs text-[var(--dpf-error)]";

/**
 * Primary submit button — form-kit compat surface. Kept for the existing form
 * contract (SubmitButton composes it); NEW standalone buttons compose
 * `ui/Button` instead of raw class strings. Label resolves through
 * --dpf-on-accent so it passes WCAG AA in both themes and under brand
 * overrides (BI-D25ED55D — text-white on accent was the pre-token defect).
 */
export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[var(--dpf-accent)] " +
  "px-4 py-2 text-sm font-semibold text-[var(--dpf-on-accent)] transition-opacity " +
  "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";

/** Join class strings, dropping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
