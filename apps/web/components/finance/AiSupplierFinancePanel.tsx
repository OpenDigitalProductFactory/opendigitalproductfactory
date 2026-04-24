import type { getAiSupplierFinanceDetail } from "@/lib/finance/ai-provider-finance";

type SupplierFinanceDetail = Awaited<ReturnType<typeof getAiSupplierFinanceDetail>>;

export function AiSupplierFinancePanel({ detail }: { detail: SupplierFinanceDetail }) {
  if (!detail || detail.aiProviderProfiles.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">AI finance context</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {detail.aiProviderProfiles.map((profile) => {
          const latestContract = profile.supplierContracts[0] ?? null;
          const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;

          return (
            <div
              key={profile.id}
              className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--dpf-text)]">
                    {profile.provider.name}
                  </p>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {latestContract?.status.replace(/_/g, " ") ?? "draft contract"}
                  </p>
                </div>
                <a
                  href={`/platform/ai/providers/${profile.provider.providerId}`}
                  className="text-xs font-medium text-[var(--dpf-accent)]"
                >
                  Provider →
                </a>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Metric label="Work items" value={`${profile.financeWorkItems.length}`} />
                <Metric
                  label="Latest utilization"
                  value={latestSnapshot ? `${latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}%` : "No data"}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
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
