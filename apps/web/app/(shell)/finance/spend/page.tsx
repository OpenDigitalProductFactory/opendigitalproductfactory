import { prisma } from "@dpf/db";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { AiSpendSummaryCard } from "@/components/finance/AiSpendSummaryCard";
import {
  getAiSpendOverview,
  maybeRunAiProviderFinanceDailyEvaluation,
} from "@/lib/finance/ai-provider-finance";

export default async function FinanceSpendPage() {
  const [payables, submittedExpenseClaims, supplierCount, purchaseOrderCount, outboundPayments, orgSettings, aiOverview] =
    await Promise.all([
      prisma.bill.aggregate({
        where: { status: { in: ["approved", "partially_paid"] } },
        _sum: { amountDue: true },
        _count: true,
      }),
      prisma.expenseClaim.count({
        where: { status: "submitted" },
      }),
      prisma.supplier.count(),
      prisma.purchaseOrder.count(),
      prisma.payment.count({
        where: { direction: "outbound" },
      }),
      getOrgSettings(),
      maybeRunAiProviderFinanceDailyEvaluation().catch(() => undefined).then(() => getAiSpendOverview()),
    ]);

  const sym = getCurrencySymbol(orgSettings.baseCurrency);
  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Handle bills, suppliers, expenses, and other outgoing commitments.
        </p>
      </div>

      <FinanceTabNav />

      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceSummaryCard
          title="Bills"
          description="Keep approved bills moving and watch what still needs payment."
          href="/finance/bills"
          accentColor="var(--dpf-warning)"
          metrics={[
            { label: "Awaiting payment", value: `${payables._count}` },
            { label: "Amount due", value: `${sym}${formatMoney(Number(payables._sum.amountDue ?? 0))}` },
          ]}
        />
        <FinanceSummaryCard
          title="Expenses"
          description="Review employee claims and unblock approvals without leaving the spend workflow."
          href="/finance/expense-claims"
          accentColor="var(--dpf-info)"
          metrics={[
            { label: "Submitted claims", value: `${submittedExpenseClaims}` },
            { label: "Personal expenses", value: "See my expenses" },
          ]}
        />
        <FinanceSummaryCard
          title="Suppliers"
          description="Manage supplier relationships and trace purchasing activity."
          href="/finance/suppliers"
          accentColor="var(--dpf-accent)"
          metrics={[
            { label: "Suppliers", value: `${supplierCount}` },
            { label: "Purchase orders", value: `${purchaseOrderCount}` },
          ]}
        />
        <FinanceSummaryCard
          title="Outbound payments"
          description="Follow money leaving the business and connect it back to bills and procurement."
          href="/finance/payments?direction=outbound"
          accentColor="var(--dpf-error)"
          metrics={[
            { label: "Outbound payments", value: `${outboundPayments}` },
            { label: "Base currency", value: orgSettings.baseCurrency },
          ]}
        />
        <AiSpendSummaryCard
          supplierCount={aiOverview.supplierCount}
          committedSpend={aiOverview.committedSpend}
          contractsNeedingSetup={aiOverview.contractsNeedingSetup}
          projectedUnusedCommitment={aiOverview.projectedUnusedCommitment}
          currencySymbol={sym}
        />
      </div>
    </div>
  );
}
