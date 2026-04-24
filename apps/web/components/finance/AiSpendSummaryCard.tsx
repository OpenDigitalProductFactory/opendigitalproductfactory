import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";

type Props = {
  supplierCount: number;
  committedSpend: number;
  contractsNeedingSetup: number;
  projectedUnusedCommitment: number;
  currencySymbol: string;
};

function formatMoney(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AiSpendSummaryCard({
  supplierCount,
  committedSpend,
  contractsNeedingSetup,
  projectedUnusedCommitment,
  currencySymbol,
}: Props) {
  return (
    <FinanceSummaryCard
      title="AI Spend"
      description="Track AI supplier commitments, utilization pressure, and contracts that still need finance setup."
      href="/finance/spend/ai"
      accentColor="var(--dpf-info)"
      metrics={[
        { label: "AI suppliers", value: `${supplierCount}` },
        { label: "Committed spend", value: `${currencySymbol}${formatMoney(committedSpend)}` },
        { label: "Needs setup", value: `${contractsNeedingSetup}` },
        { label: "Unused at risk", value: `${currencySymbol}${formatMoney(projectedUnusedCommitment)}` },
      ]}
    />
  );
}
