import { prisma } from "@dpf/db";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceSummaryCard } from "@/components/finance/FinanceSummaryCard";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

export default async function FinanceRevenuePage() {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [receivables, overdueCount, paidThisMonth, inboundPayments, orgSettings] = await Promise.all([
    prisma.invoice.aggregate({
      where: { status: { in: ["sent", "viewed", "partially_paid", "overdue"] } },
      _sum: { amountDue: true },
      _count: true,
    }),
    prisma.invoice.count({
      where: { status: "overdue" },
    }),
    prisma.invoice.aggregate({
      where: {
        status: "paid",
        paidAt: { gte: firstDayOfMonth },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.payment.count({
      where: { direction: "inbound" },
    }),
    getOrgSettings(),
  ]);

  const sym = getCurrencySymbol(orgSettings.baseCurrency);
  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Track invoices, receivables, and money coming into the business.
        </p>
      </div>

      <FinanceTabNav />

      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceSummaryCard
          title="Invoices"
          description="Manage receivables and keep new billing moving."
          href="/finance/invoices"
          accentColor="var(--dpf-accent)"
          metrics={[
            { label: "Open invoices", value: `${receivables._count}` },
            { label: "Outstanding", value: `${sym}${formatMoney(Number(receivables._sum.amountDue ?? 0))}` },
          ]}
        />
        <FinanceSummaryCard
          title="Collections"
          description="Focus on overdue accounts and aging risk before cash gets tight."
          href="/finance/reports/aged-debtors"
          accentColor="var(--dpf-error)"
          metrics={[
            { label: "Overdue invoices", value: `${overdueCount}` },
            { label: "This month paid", value: `${sym}${formatMoney(Number(paidThisMonth._sum.totalAmount ?? 0))}` },
          ]}
        />
        <FinanceSummaryCard
          title="Payments"
          description="Review inbound payment flow and trace what has been settled."
          href="/finance/payments"
          accentColor="var(--dpf-success)"
          metrics={[
            { label: "Inbound payments", value: `${inboundPayments}` },
            { label: "Paid this month", value: `${paidThisMonth._count}` },
          ]}
        />
        <FinanceSummaryCard
          title="Revenue reporting"
          description="Jump into revenue-by-customer, outstanding invoices, and cashflow views."
          href="/finance/reports"
          accentColor="var(--dpf-info)"
          metrics={[
            { label: "Base currency", value: orgSettings.baseCurrency },
            { label: "Reports", value: "7 available" },
          ]}
        />
      </div>
    </div>
  );
}
