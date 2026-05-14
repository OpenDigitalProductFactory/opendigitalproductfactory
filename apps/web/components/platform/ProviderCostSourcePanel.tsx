import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import type { ProviderCostView } from "@/lib/inference/ai-provider-cost-view";

export function ProviderCostSourcePanel({ view }: { view: ProviderCostView }) {
  const metrics = [
    view.routingCostBand,
    view.catalogPricing,
    view.configuredBillingProfile,
    view.internalTokenUsage,
    view.externalProviderBilling,
  ];

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">Cost source truth</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Routing metadata, catalog pricing, DPF token usage, and provider billing are tracked separately.
          </p>
        </div>
        {view.externalProviderBilling.actionHref && (
          <a href={view.externalProviderBilling.actionHref} className="text-xs font-medium text-[var(--dpf-accent)]">
            Reconcile billing →
          </a>
        )}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{metric.label}</p>
            <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{metric.value}</p>
            <div className="mt-2">
              <DataSourceBadge compact provenance={metric.provenance} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
