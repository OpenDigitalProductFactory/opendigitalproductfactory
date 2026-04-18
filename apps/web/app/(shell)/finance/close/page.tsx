import { prisma } from "@dpf/db";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

export default async function FinanceClosePage() {
  const [recurringSchedules, outboundPayments, activeAssets, orgSettings] = await Promise.all([
    prisma.recurringSchedule.count({
      where: { status: "active" },
    }),
    prisma.payment.count({
      where: { direction: "outbound" },
    }),
    prisma.fixedAsset.findMany({
      where: { status: "active" },
      select: { currentBookValue: true },
    }),
    getOrgSettings(),
  ]);

  const sym = getCurrencySymbol(orgSettings.baseCurrency);
  const assetValue = activeAssets.reduce((sum, asset) => sum + Number(asset.currentBookValue), 0);
  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Run reporting, recurring schedules, payment batches, and close-oriented checks.
        </p>
      </div>

      <FinanceTabNav />

      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceSummaryCard
          title="Reports"
          description="Use the reporting stack to understand profitability, cashflow, and aged balances."
          href="/finance/reports"
          accentColor="var(--dpf-info)"
          metrics={[
            { label: "Report library", value: "7 views" },
            { label: "Base currency", value: orgSettings.baseCurrency },
          ]}
        />
        <FinanceSummaryCard
          title="Recurring work"
          description="Keep subscription and scheduled finance work healthy before each close cycle."
          href="/finance/recurring"
          accentColor="var(--dpf-success)"
          metrics={[
            { label: "Active schedules", value: `${recurringSchedules}` },
            { label: "Outbound payments", value: `${outboundPayments}` },
          ]}
        />
        <FinanceSummaryCard
          title="Assets"
          description="Review the asset register as part of period-end checks and reporting."
          href="/finance/assets"
          accentColor="var(--dpf-warning)"
          metrics={[
            { label: "Active assets", value: `${activeAssets.length}` },
            { label: "Book value", value: `${sym}${formatMoney(assetValue)}` },
          ]}
        />
        <FinanceSummaryCard
          title="Cashflow"
          description="Jump straight into the close views most likely to surface risk."
          href="/finance/reports/cash-flow"
          accentColor="var(--dpf-accent)"
          metrics={[
            { label: "Profit & Loss", value: "Ready" },
            { label: "Cashflow", value: "Ready" },
          ]}
        />
      </div>
    </div>
  );
}
