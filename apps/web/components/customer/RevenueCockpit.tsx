import Link from "next/link";
import { CustomerMetricTile } from "./CustomerMetricTile";
import type { RevenueCockpitSummary } from "@/lib/crm/revenue-cockpit";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";

type RevenueCockpitProps = {
  summary: RevenueCockpitSummary;
};

export function RevenueCockpit({ summary }: RevenueCockpitProps) {
  return (
    <section className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            Today in revenue
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            Pipeline, signals, and work that need attention
          </h2>
        </div>
        <Link
          href="/customer/marketing"
          className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
        >
          Open marketing workspace
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.metrics.map((metric) => (
          <CustomerMetricTile
            key={metric.id}
            href={metric.href}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            tone={metric.tone}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {summary.attentionItems.length > 0 ? (
          summary.attentionItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={[
                "rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--dpf-surface-2)]",
                CRM_TONE_CLASSES[item.tone].badge,
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))
        ) : (
          <p className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs text-[var(--dpf-muted)]">
            No urgent revenue actions right now.
          </p>
        )}
      </div>
    </section>
  );
}
