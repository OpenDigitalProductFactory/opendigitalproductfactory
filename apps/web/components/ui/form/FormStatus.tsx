"use client";

// FormStatus — the mutating-submit feedback region. A form's outcome must be
// announced, not just recolored: errors render assertively (role="alert"),
// success politely (role="status" + aria-live). Pending feedback lives on the
// SubmitButton (aria-busy + InlineBusy); this component owns the settled result.
//
// Render one <FormStatus> per form near the submit button. Pass at most one of
// `error` / `success`; error wins if both are set.

import type { ReactNode } from "react";
import { cx } from "./styles";

export type FormStatusProps = {
  error?: ReactNode | null;
  success?: ReactNode | null;
  className?: string;
};

export function FormStatus({ error, success, className }: FormStatusProps) {
  if (error) {
    return (
      <p role="alert" className={cx("text-sm text-[var(--dpf-error)]", className)}>
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" aria-live="polite" className={cx("text-sm text-[var(--dpf-success)]", className)}>
        {success}
      </p>
    );
  }
  // Keep a stable polite live region mounted so an async success/error that
  // replaces empty state is still announced by screen readers.
  return <div role="status" aria-live="polite" className="sr-only" />;
}
