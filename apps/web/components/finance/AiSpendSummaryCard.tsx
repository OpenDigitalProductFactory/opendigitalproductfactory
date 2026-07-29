import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";

type Props = {
  supplierCount: number;
  activeProviderCount: number;
  untrackedProviderCount: number;
  committedSpend: number;
  contractsNeedingSetup: number;
  openWorkItems: number;
  projectedUnusedCommitment: number;
  currencySymbol: string;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AiSpendSummaryCard({
  supplierCount,
  activeProviderCount,
  untrackedProviderCount,
  committedSpend,
  contractsNeedingSetup,
  openWorkItems,
  projectedUnusedCommitment,
  currencySymbol,
}: Props) {
  const hasTraceabilityGaps = untrackedProviderCount > 0 || contractsNeedingSetup > 0 || openWorkItems > 0;

  return (
    <FinanceSummaryCard
      title="AI Spend"
      description={
        hasTraceabilityGaps
          ? "AI provider costs need finance completion before the summary can be trusted."
          : "Track AI supplier commitments, utilization pressure, and finance-owned provider costs."
      }
      href="/finance/spend/ai"
      accentColor={hasTraceabilityGaps ? "var(--dpf-error)" : "var(--dpf-info)"}
      metrics={[
        { label: "AI profiles", value: `${supplierCount}/${activeProviderCount}` },
        { label: "Committed spend", value: `${currencySymbol}${formatMoney(committedSpend)}` },
        { label: "Unpriced providers", value: `${untrackedProviderCount}` },
        { label: "Employee asks", value: `${openWorkItems + contractsNeedingSetup}` },
        ...(projectedUnusedCommitment > 0
          ? [{ label: "Unused at risk", value: `${currencySymbol}${formatMoney(projectedUnusedCommitment)}` }]
          : []),
      ]}
    />
  );
}
