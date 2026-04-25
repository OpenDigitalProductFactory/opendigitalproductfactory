"use client";

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  onClose: () => void;
  children: React.ReactNode;
};

export function WorkflowDetailPanel({
  eyebrow,
  title,
  subtitle,
  onClose,
  children,
}: Props) {
  return (
    <section
      role="dialog"
      aria-label={title}
      data-testid="workflow-detail-panel"
      data-inspector-mode="inline"
      className="flex shrink-0 flex-col overflow-hidden rounded-[22px] border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-dpf-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--dpf-muted)]">
            {eyebrow}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)] focus-visible:outline-offset-2"
        >
          {"\u2715"}
        </button>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)]">
        {children}
      </div>
    </section>
  );
}
