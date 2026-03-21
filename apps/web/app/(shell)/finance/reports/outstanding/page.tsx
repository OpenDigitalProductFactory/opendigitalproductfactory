// apps/web/app/(shell)/finance/reports/outstanding/page.tsx
import Link from "next/link";
import { getOutstandingInvoicesReport } from "@/lib/actions/reports";

const formatMoney = (amount: number) =>
  `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

function overdueColour(days: number): string {
  if (days <= 7) return "#fbbf24";
  if (days <= 30) return "#fb923c";
  if (days <= 60) return "#ef4444";
  return "#dc2626";
}

export default async function OutstandingInvoicesPage() {
  const invoices = await getOutstandingInvoicesReport();

  // Sort by days overdue descending (worst first)
  const sorted = [...invoices].sort((a, b) => b.daysOverdue - a.daysOverdue);

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
        <Link
          href="/finance/reports"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Reports
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">
          Outstanding Invoices
        </span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Outstanding Invoices
        </h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Unpaid invoices sorted by urgency
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[#4ade80]">
            No outstanding invoices — all paid up!
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Invoice Ref
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Customer
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount Due
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Due Date
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Days Overdue
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((inv) => {
                const colour =
                  inv.daysOverdue > 0
                    ? overdueColour(inv.daysOverdue)
                    : "#4ade80";
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/invoices/${inv.id}`}
                        className="font-mono text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                      >
                        {inv.invoiceRef}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                      {inv.accountName}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)] font-medium">
                      {formatMoney(inv.amountDue)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                      {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                    </td>
                    <td
                      className="px-4 py-2.5 text-right font-semibold"
                      style={{ color: colour }}
                    >
                      {inv.daysOverdue > 0 ? `${inv.daysOverdue}d` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{
                          color: colour,
                          backgroundColor: `${colour}20`,
                        }}
                      >
                        {inv.status.replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Export */}
      <Link
        href="/api/v1/finance/reports/outstanding?format=csv"
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
      >
        Export CSV
      </Link>
    </div>
  );
}
