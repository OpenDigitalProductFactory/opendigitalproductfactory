// apps/web/app/(shell)/finance/invoices/page.tsx
import { prisma } from "@dpf/db";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

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

const ALL_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "overdue",
  "partially_paid",
  "paid",
];

type Props = { searchParams: Promise<{ status?: string }> };

export default async function InvoicesPage({ searchParams }: Props) {
  const { status } = await searchParams;

  const [invoices, statusCounts, orgSettings] = await Promise.all([
    prisma.invoice.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invoiceRef: true,
        status: true,
        totalAmount: true,
        dueDate: true,
        account: { select: { name: true } },
      },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      _count: true,
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const countByStatus = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count])
  );
  const totalCount = statusCounts.reduce((sum, s) => sum + s._count, 0);

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Invoices</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Invoices</h1>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Invoice
        </Link>
      </div>

      <FinanceTabNav />

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/invoices"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All ({totalCount})
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#6b7280";
          const count = countByStatus[s] ?? 0;
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/finance/invoices?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s.replace("_", " ")}
              </span>{" "}
              ({count})
            </Link>
          );
        })}
      </div>

      {/* Invoices table */}
      {invoices.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No invoices found.</p>
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
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Due Date
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const colour = STATUS_COLOURS[inv.status] ?? "#6b7280";
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
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
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sym}{formatMoney(Number(inv.totalAmount))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
