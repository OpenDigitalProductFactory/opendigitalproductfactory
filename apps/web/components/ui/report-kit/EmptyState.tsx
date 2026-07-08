// apps/web/components/ui/report-kit/EmptyState.tsx
//
// Canonical "nothing here yet" block for the reporting palette. Generalizes the
// ~40 hand-rolled `No … found` / empty-list divs scattered across the portal
// into one token-backed primitive. Server-usable (pure, no hooks).
//
// Color comes from `--dpf-*` tokens only — never raw hex.

export interface EmptyStateProps {
  /** Headline, e.g. "No invoices found". */
  title: React.ReactNode;
  /** Optional secondary line explaining the emptiness or the next step. */
  description?: React.ReactNode;
  /** Optional leading glyph (emoji or icon node) shown above the title. */
  icon?: React.ReactNode;
  /** Optional call-to-action node (a link or button) rendered below the copy. */
  action?: React.ReactNode;
  /** `md` (default) is a padded card; `sm` is a compact inline message. */
  size?: "sm" | "md";
  /** Draw the dashed container border (default true). */
  bordered?: boolean;
  className?: string;
}

const PAD: Record<NonNullable<EmptyStateProps["size"]>, string> = {
  sm: "px-4 py-6",
  md: "px-6 py-12",
};

/**
 * Centered empty-state placeholder. Supply a `title`; optionally an `icon`,
 * `description`, and `action`.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  size = "md",
  bordered = true,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={[
        "flex flex-col items-center justify-center gap-2 text-center",
        bordered
          ? "rounded-xl border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          : "",
        PAD[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? (
        <div aria-hidden="true" className="text-2xl text-[var(--dpf-muted)]">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-[var(--dpf-text)]">{title}</p>
      {description ? (
        <p className="max-w-prose text-xs text-[var(--dpf-muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
