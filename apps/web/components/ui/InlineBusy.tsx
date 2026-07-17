// apps/web/components/ui/InlineBusy.tsx
//
// Canonical inline busy affordance: a small spinner + a visible text label, for
// a button's or control's pending state. One call replaces the hand-rolled
// "spin a glyph next to some text" idiom scattered across the portal. Server-
// usable (no hooks, no "use client"). See docs/platform-usability-standards.md.
//
// Renders `role="status"` + `aria-live="polite"` so the pending text ("Saving…")
// is announced; the spinner ring itself is decorative. Pair with `aria-busy` on
// the enclosing button.

import { Spinner, type SpinnerSize } from "./Spinner";

export type InlineBusyProps = {
  /** Visible pending text, e.g. "Summarizing…", "Saving…". */
  label: string;
  size?: SpinnerSize;
  /** Passed to the spinner: `"current"` inherits the button's text color. */
  tone?: "accent" | "current";
  className?: string;
};

export function InlineBusy({ label, size = "xs", tone = "accent", className = "" }: InlineBusyProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={["inline-flex items-center gap-1.5", className]
        .filter(Boolean)
        .join(" ")}
    >
      <Spinner size={size} tone={tone} presentational />
      <span>{label}</span>
    </span>
  );
}
