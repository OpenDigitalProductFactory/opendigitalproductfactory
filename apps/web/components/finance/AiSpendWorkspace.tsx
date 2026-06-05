import type {
  getAiSpendOverview,
  listAiProviderFinanceProfiles,
} from "@/lib/finance/ai-provider-finance";
import { StatCard } from "@/components/ui/report-kit";
import { AiSpendProviderTable, type AiSpendProviderTableRow } from "./AiSpendProviderTable";

type Overview = Awaited<ReturnType<typeof getAiSpendOverview>>;
type Rows = Awaited<ReturnType<typeof listAiProviderFinanceProfiles>>;

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function humanize(value: string | null | undefined) {
  if (!value) return "None";
  const words = value
    .split("_")
    .filter(Boolean)
    .join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function buildRows(rows: Rows, currencySymbol: string): AiSpendProviderTableRow[] {
  return rows.map((row) => {
    const latestContract = row.supplierContracts[0] ?? null;
    const latestSnapshot = latestContract?.usageSnapshots[0] ?? null;
    const committed = Number(latestContract?.monthlyCommittedAmount ?? 0);
    const metered = row.actualSpendMtd.costUsd;
    const primaryWorkItem = row.financeWorkItems[0] ?? null;
    const needsSetup = !latestContract || latestContract.status === "draft" || committed === 0 || row.financeWorkItems.length > 0;
    const financeStatus = needsSetup ? "needs_setup" : "tracked";

    return {
      id: row.id,
      providerId: row.provider.providerId,
      providerName: row.provider.name,
      providerStatus: row.provider.status,
      supplierId: row.supplier?.id ?? null,
      supplierName: row.supplier?.name ?? null,
      financeStatus,
      financeStatusLabel: financeStatus === "tracked" ? "Tracked" : "Needs setup",
      commitmentLabel: committed > 0 ? `${currencySymbol}${formatMoney(committed)}` : "Needs finance input",
      meteredSpendLabel: metered > 0 ? `${currencySymbol}${formatMoney(metered)}` : "No metered spend",
      utilizationLabel: latestSnapshot ? `${latestSnapshot.utilizationPct?.toFixed(1) ?? "0.0"}%` : "No snapshot",
      workItemCount: row.financeWorkItems.length,
      primaryWorkItemType: primaryWorkItem?.type ?? null,
      primaryWorkItemLabel: primaryWorkItem ? humanize(primaryWorkItem.type) : "No asks",
    };
  });
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
  const tableRows = buildRows(rows, currencySymbol);
  const providerHint = `${overview.untrackedProviderCount} active provider${overview.untrackedProviderCount === 1 ? "" : "s"} need a finance profile`;
  const traceabilityGapCount = overview.dataQualityIssueCount
    ?? overview.untrackedProviderCount + overview.contractsNeedingSetup + overview.openWorkItems;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="AI finance profiles"
          value={`${overview.supplierCount}/${overview.activeProviderCount}`}
          hint={providerHint}
          intent={overview.untrackedProviderCount > 0 ? "warning" : "success"}
        />
        <StatCard
          label="Committed spend"
          value={`${currencySymbol}${formatMoney(overview.committedSpend)}`}
          hint="Known monthly commitments only"
          intent={overview.contractsNeedingSetup > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Unpriced active providers"
          value={`${overview.untrackedProviderCount}`}
          hint={`${overview.contractsNeedingSetup} need finance setup`}
          intent={overview.untrackedProviderCount > 0 || overview.contractsNeedingSetup > 0 ? "danger" : "success"}
        />
        <StatCard
          label="Human asks queued"
          value={`${overview.openWorkItems}`}
          hint="Finance Specialist follow-ups"
          intent={overview.openWorkItems > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="Metered spend MTD"
          value={`${currencySymbol}${formatMoney(overview.actualMeteredSpendUsd)}`}
          hint={`${overview.inferenceCallsThisMonth.toLocaleString()} API calls; subscription plans need contract details`}
          intent={overview.actualMeteredSpendUsd > overview.committedSpend * 0.8 ? "warning" : "neutral"}
        />
        <StatCard
          label="Financial traceability gaps"
          value={`${traceabilityGapCount}`}
          hint="Untracked providers, draft commitments, and open asks"
          intent={traceabilityGapCount > 0 ? "danger" : "success"}
        />
      </div>

      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Utilization and ownership</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Monitor committed spend, latest utilization, and provider contracts that still need finance completion.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <AiSpendProviderTable rows={tableRows} />
        </div>
      </div>
    </div>
  );
}
