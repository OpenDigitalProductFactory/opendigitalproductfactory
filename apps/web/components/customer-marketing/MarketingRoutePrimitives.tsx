import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import { StatCard, StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit";
import { formatMarketingLabel } from "@/lib/marketing";
import type { MarketingMetric } from "@/lib/marketing/subroutes";

export function MarketingPageHeader({
  eyebrow,
  title,
  description,
  actionHref,
  actionLabel,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--dpf-text)]">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
          {description}
        </p>
      </div>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-2 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function MarketingMetricGrid({ metrics }: { metrics: MarketingMetric[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {metrics.map((metric) => (
        <StatCard
          key={metric.label}
          label={metric.label}
          value={metric.value}
          hint={metric.hint}
          intent={metric.intent}
        />
      ))}
    </div>
  );
}

export function MarketingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function MarketingEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <h2 className="text-base font-semibold text-[var(--dpf-text)]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--dpf-muted)]">{description}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-4 inline-flex rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function MarketingRecordCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={[
        "rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </article>
  );
}

export function MarketingLifecycleBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <StatusBadge
      domain="marketing"
      status={status}
      label={label ?? formatMarketingLabel(status)}
      uppercase={false}
      variant="soft"
    />
  );
}

export function MarketingIntentBadge({
  intent,
  label,
}: {
  intent: Intent;
  label: string;
}) {
  return (
    <StatusBadge intent={intent} label={label} uppercase={false} variant="soft" />
  );
}

export function MarketingDate({
  value,
  fallback = "No date",
}: {
  value: Date | string | null | undefined;
  fallback?: string;
}) {
  return (
    <LocalTime
      value={value}
      mode="date"
      utc
      fallback={fallback}
      className="text-[var(--dpf-muted)]"
    />
  );
}
