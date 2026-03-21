// apps/web/app/(shell)/finance/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  viewed: "#a78bfa",
  overdue: "#ef4444",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
  written_off: "#6b7280",
};

export default async function FinancePage() {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalOutstanding,
    overdueInvoices,
    paidThisMonth,
    recentInvoices,
    moneyYouOwe,
    bankAccounts,
    expectedInflows,
    expectedOutflows,
    activeRecurringCount,
    overdueGt30,
    pendingExpenseCount,
    activeAssets,
  ] = await Promise.all([
    // Money owed to you — sum amountDue for active receivable statuses
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
      },
      _sum: { amountDue: true },
      _count: true,
    }),

    // Overdue invoices — full list for count + oldest offender
    prisma.invoice.findMany({
      where: { status: "overdue" },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        invoiceRef: true,
        dueDate: true,
        account: { select: { name: true } },
      },
    }),

    // Money in this month — paid invoices with paidAt >= first day of month
    prisma.invoice.aggregate({
      where: {
        status: "paid",
        paidAt: { gte: firstDayOfMonth },
      },
      _sum: { totalAmount: true },
      _count: true,
    }),

    // Recent invoices — last 10
    prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        invoiceRef: true,
        status: true,
        totalAmount: true,
        account: { select: { name: true } },
      },
    }),

    // Money you owe — sum amountDue for approved/partially_paid bills (AP)
    prisma.bill.aggregate({
      where: {
        status: { in: ["approved", "partially_paid"] },
      },
      _sum: { amountDue: true },
      _count: true,
    }),

    // Cash position — active bank accounts
    prisma.bankAccount.findMany({
      where: { status: "active" },
      select: { name: true, currentBalance: true, currency: true },
    }),

    // 30-day cash flow forecast — expected inflows (invoices due in next 30 days)
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        dueDate: { gte: now, lte: in30Days },
      },
      _sum: { amountDue: true },
    }),

    // 30-day cash flow forecast — expected outflows (bills due in next 30 days)
    prisma.bill.aggregate({
      where: {
        status: { in: ["approved", "partially_paid"] },
        dueDate: { gte: now, lte: in30Days },
      },
      _sum: { amountDue: true },
    }),

    // Active recurring schedules count
    prisma.recurringSchedule.count({
      where: { status: "active" },
    }),

    // Overdue > 30 days — sum amountDue for invoices overdue more than 30 days
    prisma.invoice.aggregate({
      where: {
        status: { in: ["sent", "viewed", "partially_paid", "overdue"] },
        dueDate: { lt: thirtyDaysAgo },
      },
      _sum: { amountDue: true },
    }),

    // Pending expense claims
    prisma.expenseClaim.count({
      where: { status: "submitted" },
    }),

    // Active fixed assets — sum currentBookValue and count by category
    prisma.fixedAsset.findMany({
      where: { status: "active" },
      select: { currentBookValue: true, category: true },
    }),
  ]);

  const owedAmount = Number(totalOutstanding._sum.amountDue ?? 0);
  const owedCount = totalOutstanding._count;
  const paidAmount = Number(paidThisMonth._sum.totalAmount ?? 0);
  const paidCount = paidThisMonth._count;
  const overdueCount = overdueInvoices.length;
  const oldestOverdue = overdueInvoices[0];
  const moneyOweAmount = Number(moneyYouOwe._sum.amountDue ?? 0);
  const moneyOweCount = moneyYouOwe._count;
  const overdueGt30Amount = Number(overdueGt30._sum.amountDue ?? 0);

  // Cash position
  const totalCash = bankAccounts.reduce(
    (sum, a) => sum + Number(a.currentBalance),
    0,
  );
  const inflowsIn30 = Number(expectedInflows._sum.amountDue ?? 0);
  const outflowsIn30 = Number(expectedOutflows._sum.amountDue ?? 0);
  const forecastBalance = totalCash + inflowsIn30 - outflowsIn30;

  // Asset register
  const totalAssetValue = activeAssets.reduce(
    (sum, a) => sum + Number(a.currentBookValue),
    0,
  );
  const assetCategoryCount = new Set(activeAssets.map((a) => a.category)).size;

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Finance</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Invoicing &amp; payments
          </p>
        </div>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Invoice
        </Link>
      </div>

      {/* Row 1: Cash Position + 30-day Forecast + Outstanding + Overdue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {/* Widget 1: Cash Position */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Cash Position
          </p>
          {bankAccounts.length === 0 ? (
            <div>
              <p className="text-xs text-[var(--dpf-muted)] mb-2">No bank accounts</p>
              <Link
                href="/finance/banking"
                className="text-[10px] text-[var(--dpf-accent)] hover:underline"
              >
                Add one →
              </Link>
            </div>
          ) : (
            <>
              <p
                className="text-2xl font-bold"
                style={{ color: totalCash >= 0 ? "#4ade80" : "#ef4444" }}
              >
                £{formatMoney(totalCash)}
              </p>
              <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
                across {bankAccounts.length} account{bankAccounts.length !== 1 ? "s" : ""}
              </p>
            </>
          )}
        </div>

        {/* Widget 2: 30-Day Cash Flow Forecast */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            30-Day Forecast
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: forecastBalance >= totalCash ? "#4ade80" : "#ef4444" }}
          >
            £{formatMoney(forecastBalance)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            +£{formatMoney(inflowsIn30)} in · -£{formatMoney(outflowsIn30)} out
          </p>
        </div>

        {/* Widget 3: Outstanding Invoices */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Money Owed To You
          </p>
          <p className="text-2xl font-bold text-[var(--dpf-text)]">
            £{formatMoney(owedAmount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {owedCount} invoice{owedCount !== 1 ? "s" : ""} outstanding
          </p>
        </div>

        {/* Widget 4: Overdue */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Overdue
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: overdueCount > 0 ? "#ef4444" : "#4ade80" }}
          >
            {overdueCount}
          </p>
          {overdueCount > 0 && oldestOverdue ? (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1 truncate">
              Oldest:{" "}
              <span className="text-[var(--dpf-text)]">{oldestOverdue.account.name}</span>
            </p>
          ) : (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
              All up to date
            </p>
          )}
        </div>
      </div>

      {/* Row 2: Money In + Money You Owe + Active Recurring + Overdue >30 days */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Money In This Month */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Money In This Month
          </p>
          <p className="text-2xl font-bold text-[var(--dpf-text)]">
            £{formatMoney(paidAmount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {paidCount} invoice{paidCount !== 1 ? "s" : ""} paid
          </p>
        </div>

        {/* Money You Owe */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Money You Owe
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: moneyOweAmount > 0 ? "#ef4444" : "#4ade80" }}
          >
            £{formatMoney(moneyOweAmount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {moneyOweCount} bill{moneyOweCount !== 1 ? "s" : ""} awaiting payment
          </p>
        </div>

        {/* Active Recurring */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Active Recurring
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: activeRecurringCount > 0 ? "#4ade80" : "#8888a0" }}
          >
            {activeRecurringCount}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            <Link href="/finance/recurring" className="hover:underline">
              schedule{activeRecurringCount !== 1 ? "s" : ""} running →
            </Link>
          </p>
        </div>

        {/* Overdue > 30 days */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Overdue &gt; 30 Days
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: overdueGt30Amount > 0 ? "#ef4444" : "#4ade80" }}
          >
            £{formatMoney(overdueGt30Amount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            <Link href="/finance/reports/aged-debtors" className="hover:underline">
              view aged debtors →
            </Link>
          </p>
        </div>
      </div>

      {/* Row 3: People + Asset widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Pending Expenses */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Pending Expenses
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: pendingExpenseCount > 0 ? "#a78bfa" : "#4ade80" }}
          >
            {pendingExpenseCount}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            <Link href="/finance/expense-claims?status=submitted" className="hover:underline">
              claim{pendingExpenseCount !== 1 ? "s" : ""} awaiting approval →
            </Link>
          </p>
        </div>

        {/* Total Asset Value */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Total Asset Value
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: totalAssetValue > 0 ? "#4ade80" : "#8888a0" }}
          >
            £{formatMoney(totalAssetValue)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {activeAssets.length} asset{activeAssets.length !== 1 ? "s" : ""} across{" "}
            {assetCategoryCount} categor{assetCategoryCount !== 1 ? "ies" : "y"} ·{" "}
            <Link href="/finance/assets" className="hover:underline">
              view register →
            </Link>
          </p>
        </div>
      </div>

      {/* Navigation links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* AR links */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Accounts Receivable
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/invoices" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Invoices →
            </Link>
            <Link href="/finance/payments" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Payments →
            </Link>
            <Link href="/finance/recurring" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Recurring Schedules →
            </Link>
          </div>
        </div>

        {/* AP links */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Accounts Payable
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/suppliers" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Suppliers →
            </Link>
            <Link href="/finance/bills" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bills →
            </Link>
          </div>
        </div>

        {/* Procurement */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Procurement
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/purchase-orders" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Purchase Orders →
            </Link>
            <Link href="/finance/payment-runs" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Payment Runs →
            </Link>
          </div>
        </div>

        {/* Banking */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Banking
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/banking" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bank Accounts →
            </Link>
            <Link href="/finance/banking/rules" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Bank Rules →
            </Link>
          </div>
        </div>

        {/* Reports */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Reports
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/reports" className="text-xs text-[var(--dpf-accent)] hover:underline">
              All Reports →
            </Link>
            <Link href="/finance/reports/profit-loss" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Profit &amp; Loss →
            </Link>
            <Link href="/finance/reports/cash-flow" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Cash Flow →
            </Link>
            <Link href="/finance/reports/vat-summary" className="text-xs text-[var(--dpf-accent)] hover:underline">
              VAT Summary →
            </Link>
            <Link href="/finance/reports/outstanding" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Outstanding Invoices →
            </Link>
            <Link href="/finance/reports/aged-debtors" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Aged Debtors →
            </Link>
            <Link href="/finance/reports/aged-creditors" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Aged Creditors →
            </Link>
          </div>
        </div>

        {/* People */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            People
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/expense-claims" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Expense Claims →
            </Link>
            <Link href="/portal/expenses" className="text-xs text-[var(--dpf-accent)] hover:underline">
              My Expenses →
            </Link>
          </div>
        </div>

        {/* Management */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Management
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/assets" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Asset Register →
            </Link>
            <Link href="/finance/assets/new" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Register Asset →
            </Link>
            <Link href="/finance/settings/currency" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Currency Settings →
            </Link>
          </div>
        </div>

        {/* Settings */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Settings
          </p>
          <div className="flex flex-col gap-2">
            <Link href="/finance/settings/dunning" className="text-xs text-[var(--dpf-accent)] hover:underline">
              Dunning Settings →
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Recent Invoices
        </h2>

        {recentInvoices.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No invoices yet. Create your first invoice to get started.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Ref
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Account
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Status
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentInvoices.map((inv) => {
                  const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-1)] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                        >
                          {inv.invoiceRef}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="text-[var(--dpf-text)] hover:underline"
                        >
                          {inv.account.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: colour,
                            backgroundColor: `${colour}20`,
                          }}
                        >
                          {inv.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        £{formatMoney(Number(inv.totalAmount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
