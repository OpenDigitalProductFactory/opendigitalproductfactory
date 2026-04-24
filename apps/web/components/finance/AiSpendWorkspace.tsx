import type {
  getAiSpendOverview,
  listAiProviderFinanceProfiles,
} from "@/lib/finance/ai-provider-finance";

type Overview = Awaited<ReturnType<typeof getAiSpendOverview>>;
type Rows = Awaited<ReturnType<typeof listAiProviderFinanceProfiles>>;

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AiSpendWorkspace({
  overview,
  rows,
  currencySymbol,
}: {
  overview: Overview;
  rows: Rows;
  currencySymbol: string;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="AI suppliers" value={`${overview.supplierCount}`} />
        <Metric label="Committed spend" value={`${currencySymbol}${formatMoney(overview.committedSpend)}`} />
        <Metric label="Needs setup" value={`${overview.contractsNeedingSetup}`} />
        <Metric label="Open work items" value={`${overview.openWorkItems}`} />
      </div>

      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Utilization and ownership</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Monitor committed spend, latest utilization, and contracts that still need finance completion.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)] text-left">
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)] font-normal">Provider</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)] font-normal">Supplier</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)] font-normal">Commitment</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)] font-normal">Latest utilization</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)] font-normal">Work items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const latestContract = row.supplierContracts[0] ?? null;
                const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;
                return (
                  <tr key={row.id} className="border-b border-[var(--dpf-border)] last:border-0">
                    <td className="px-3 py-3 text-[var(--dpf-text)]">
                      <a href={`/platform/ai/providers/${row.provider.providerId}`} className="font-medium text-[var(--dpf-accent)]">
                        {row.provider.name}
                      </a>
                    </td>
                    <td className="px-3 py-3 text-[var(--dpf-muted)]">
                      {row.supplier ? (
                        <a href={`/finance/suppliers/${row.supplier.id}`} className="text-[var(--dpf-accent)]">
                          {row.supplier.name}
                        </a>
                      ) : "Not linked"}
                    </td>
                    <td className="px-3 py-3 text-[var(--dpf-text)]">
                      {currencySymbol}{formatMoney(Number(latestContract?.monthlyCommittedAmount ?? 0))}
                    </td>
                    <td className="px-3 py-3 text-[var(--dpf-text)]">
                      {latestSnapshot ? `${latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}%` : "No data"}
                    </td>
                    <td className="px-3 py-3 text-[var(--dpf-muted)]">{row.financeWorkItems.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}
