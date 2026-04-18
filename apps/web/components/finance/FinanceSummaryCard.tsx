import Link from "next/link";

type FinanceSummaryMetric = {
  label: string;
  value: string;
};

type Props = {
  title: string;
  description: string;
  href: string;
  ctaLabel?: string;
  accentColor?: string;
  metrics?: FinanceSummaryMetric[];
};

export function FinanceSummaryCard({
  title,
  description,
  href,
  ctaLabel = "Open",
  accentColor = "var(--dpf-accent)",
  metrics = [],
}: Props) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]"
      style={{ borderLeftColor: accentColor, borderLeftWidth: "4px" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{title}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{description}</p>
        </div>
        <span className="shrink-0 text-[11px] font-medium text-[var(--dpf-accent)]">
          {ctaLabel} →
        </span>
      </div>

      {metrics.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                {metric.label}
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{metric.value}</p>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
