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

  const [totalOutstanding, overdueInvoices, paidThisMonth, recentInvoices] =
    await Promise.all([
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
    ]);

  const owedAmount = Number(totalOutstanding._sum.amountDue ?? 0);
  const owedCount = totalOutstanding._count;
  const paidAmount = Number(paidThisMonth._sum.totalAmount ?? 0);
  const paidCount = paidThisMonth._count;
  const overdueCount = overdueInvoices.length;
  const oldestOverdue = overdueInvoices[0];

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Finance</h1>
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

      {/* 4 Widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Money Owed To You */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Money Owed To You
          </p>
          <p className="text-2xl font-bold text-white">
            £{formatMoney(owedAmount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {owedCount} invoice{owedCount !== 1 ? "s" : ""} outstanding
          </p>
        </div>

        {/* Overdue */}
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
              <span className="text-white">{oldestOverdue.account.name}</span>
            </p>
          ) : (
            <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
              All up to date
            </p>
          )}
        </div>

        {/* Money In This Month */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Money In This Month
          </p>
          <p className="text-2xl font-bold text-white">
            £{formatMoney(paidAmount)}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-1">
            {paidCount} invoice{paidCount !== 1 ? "s" : ""} paid
          </p>
        </div>

        {/* Quick Actions */}
        <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Quick Actions
          </p>
          <div className="flex flex-col gap-2 mt-1">
            <Link
              href="/finance/invoices"
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              All Invoices →
            </Link>
            <Link
              href="/finance/payments"
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              Payments →
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
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-white transition-colors"
                        >
                          {inv.invoiceRef}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="text-white hover:underline"
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
                      <td className="px-4 py-2.5 text-right text-white">
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
