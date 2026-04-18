import Link from "next/link";

type Metric = {
  label: string;
  value: string | number;
};

type Props = {
  title: string;
  description: string;
  href: string;
  metrics?: Metric[];
  accent?: string;
};

export function PlatformSummaryCard({
  title,
  description,
  href,
  metrics = [],
  accent = "var(--dpf-accent)",
}: Props) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 transition-transform hover:-translate-y-0.5"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-lg font-semibold text-[var(--dpf-text)]">{title}</p>
          <p className="text-sm text-[var(--dpf-muted)]">{description}</p>
        </div>
        <span className="text-sm text-[var(--dpf-accent)]">Open →</span>
      </div>

      {metrics.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                {metric.label}
              </p>
              <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
