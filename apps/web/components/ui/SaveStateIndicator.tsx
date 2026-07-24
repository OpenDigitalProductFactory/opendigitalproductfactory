"use client";

// BI-20716EA4 — the visible pending/saved/failed region for a preference or
// tuning control, paired with `useSaveState` (lib/shared/use-save-state.ts).
// Renders close to the control it describes (not a global toast) so the owner
// can see, next to the exact thing they touched, whether it saved. Mirrors the
// `FormStatus` contract (error assertive, success/pending polite) but adds the
// pending phase and the Retry/Revert affordances a settled form doesn't need.

import { InlineBusy } from "./InlineBusy";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";
import type { SaveStatus } from "@/lib/shared/use-save-state";

export type SaveStateIndicatorProps = {
  status: SaveStatus;
  /** Plain-language failure reason (from useSaveState's `error`). */
  error?: string | null;
  onRetry?: () => void;
  onRevert?: () => void;
  /** Visible text while `status === "pending"`. */
  pendingLabel?: string;
  /** Visible text while `status === "saved"`. */
  savedLabel?: string;
  /** Compact renders inline text only (no InlineBusy spinner) — for dense
   *  rows/docks where a spinner would be too heavy. */
  compact?: boolean;
  className?: string;
};

export function SaveStateIndicator({
  status,
  error,
  onRetry,
  onRevert,
  pendingLabel = "Saving…",
  savedLabel = "Saved",
  compact = false,
  className = "",
}: SaveStateIndicatorProps) {
  if (status === "pending") {
    return compact ? (
      <span role="status" aria-live="polite" className={cx("text-xs text-[var(--dpf-muted)]", className)}>
        {pendingLabel}
      </span>
    ) : (
      <InlineBusy label={pendingLabel} className={className} />
    );
  }

  if (status === "saved") {
    return (
      <span
        role="status"
        aria-live="polite"
        className={cx("text-xs font-medium text-[var(--dpf-success)]", className)}
      >
        {savedLabel}
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className={cx("inline-flex flex-wrap items-center gap-2", className)}>
        <span role="alert" className="text-xs font-medium text-[var(--dpf-error)]">
          {error ?? "Couldn't save. Try again."}
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={cx(
              SHELL_TAP_TARGET_CLASS,
              "rounded-md border border-[var(--dpf-error)] px-2 py-0.5 text-xs font-semibold text-[var(--dpf-error)] hover:bg-[var(--dpf-state-error)]",
            )}
          >
            Retry
          </button>
        )}
        {onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className={cx(
              SHELL_TAP_TARGET_CLASS,
              "rounded-md border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]",
            )}
          >
            Revert
          </button>
        )}
      </span>
    );
  }

  // idle — keep a stable, empty polite live region so an async transition
  // straight from idle into an announced state doesn't fail to register with
  // assistive tech (same idiom as FormStatus).
  return <span role="status" aria-live="polite" className="sr-only" />;
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
