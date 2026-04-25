import type { getAiProviderFinanceDetail } from "@/lib/finance/ai-provider-finance";

type ProviderFinanceDetail = Awaited<ReturnType<typeof getAiProviderFinanceDetail>>;

export function AiProviderFinancePanel({ detail }: { detail: ProviderFinanceDetail }) {
  if (!detail) {
    return (
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">Finance bridge</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          This provider has not been handed off to Finance yet.
        </p>
      </div>
    );
  }

  const latestContract = detail.supplierContracts[0] ?? null;
  const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;

  return (
    <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">Finance bridge</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Supplier ownership, contract status, and current utilization context for this provider.
          </p>
        </div>
        {detail.supplier && (
          <a
            href={`/finance/suppliers/${detail.supplier.id}`}
            className="text-xs font-medium text-[var(--dpf-accent)]"
          >
            View supplier →
          </a>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Finance status" value={detail.status.replace(/_/g, " ")} />
        <Metric label="Supplier" value={detail.supplier?.name ?? "Not linked"} />
        <Metric label="Contract" value={latestContract?.status.replace(/_/g, " ") ?? "Not created"} />
        <Metric
          label="Open work items"
          value={`${detail.financeWorkItems.filter((item) => item.status !== "done").length}`}
        />
      </div>

      {(detail.billingUrl || detail.usageUrl) && (
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          {detail.billingUrl && (
            <a href={detail.billingUrl} target="_blank" rel="noreferrer" className="text-[var(--dpf-accent)]">
              Billing portal
            </a>
          )}
          {detail.usageUrl && (
            <a href={detail.usageUrl} target="_blank" rel="noreferrer" className="text-[var(--dpf-accent)]">
              Usage portal
            </a>
          )}
        </div>
      )}

      {latestSnapshot && (
        <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Latest utilization</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}% utilized on{" "}
            {new Date(latestSnapshot.snapshotDate).toLocaleDateString("en-US")}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}
