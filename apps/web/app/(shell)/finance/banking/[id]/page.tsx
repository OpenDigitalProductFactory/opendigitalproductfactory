// apps/web/app/(shell)/finance/banking/[id]/page.tsx
import { getBankAccount, getReconciliationSummary } from "@/lib/actions/banking";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrencySymbol } from "@/lib/currency-symbol";

const MATCH_STATUS_COLOURS: Record<string, string> = {
  unmatched: "#fbbf24",
  matched: "#4ade80",
  manually_matched: "#4ade80",
  excluded: "#8888a0",
};

type Props = { params: Promise<{ id: string }> };

export default async function BankAccountDetailPage({ params }: Props) {
  const { id } = await params;

  const [account, summary] = await Promise.all([
    getBankAccount(id),
    getReconciliationSummary(id),
  ]);

  if (!account) notFound();

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const maskAccountNumber = (accountNumber: string | null) => {
    if (!accountNumber) return null;
    const last4 = accountNumber.slice(-4);
    return `****${last4}`;
  };

  const masked = maskAccountNumber(account.accountNumber);
  const balance = Number(account.currentBalance);

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
          href="/finance/banking"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Banking
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{account.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{account.name}</h1>
          {account.bankName && (
            <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{account.bankName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/finance/banking/${id}/import`}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] transition-colors"
          >
            Import Statement
          </Link>
          <Link
            href={`/finance/banking/${id}/reconcile`}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Reconcile
          </Link>
        </div>
      </div>

      {/* Account metadata */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Account Number", value: masked ?? "—" },
          { label: "Sort Code", value: account.sortCode ?? "—" },
          { label: "Currency", value: account.currency },
          { label: "Account Type", value: account.accountType.replace("_", " ") },
          {
            label: "Opening Balance",
            value: `${getCurrencySymbol(account.currency)} ${formatMoney(account.openingBalance)}`,
          },
          {
            label: "Current Balance",
            value: `${getCurrencySymbol(account.currency)} ${formatMoney(balance)}`,
          },
          {
            label: "Last Reconciled",
            value: account.lastReconciledAt
              ? new Date(account.lastReconciledAt).toLocaleDateString("en-GB")
              : "Never",
          },
          {
            label: "Bank Rules",
            value: "View →",
            href: "/finance/banking/rules",
          },
        ].map(({ label, value, href }) => (
          <div
            key={label}
            className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
          >
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
              {label}
            </p>
            {href ? (
              <Link href={href} className="text-sm text-[var(--dpf-accent)] hover:underline">
                {value}
              </Link>
            ) : (
              <p className="text-sm text-[var(--dpf-text)]">{value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Reconciliation summary */}
      <div className="mb-8 p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] flex items-center gap-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">
            Reconciliation Status
          </p>
          <p className="text-sm text-[var(--dpf-text)]">
            <span
              style={{ color: summary.unmatchedCount > 0 ? "#fbbf24" : "#4ade80" }}
            >
              {summary.unmatchedCount}
            </span>{" "}
            unmatched of{" "}
            <span className="text-[var(--dpf-text)]">{summary.totalCount}</span> total
            transactions
          </p>
        </div>
        {summary.unmatchedCount > 0 && (
          <Link
            href={`/finance/banking/${id}/reconcile`}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Reconcile now →
          </Link>
        )}
      </div>

      {/* Recent transactions */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Recent Transactions (last 50)
        </h2>

        {account.transactions.length === 0 ? (
          <div className="p-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
            <p className="text-sm text-[var(--dpf-muted)] mb-2">No transactions yet.</p>
            <Link
              href={`/finance/banking/${id}/import`}
              className="text-xs text-[var(--dpf-accent)] hover:underline"
            >
              Import a statement →
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Date
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Description
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Reference
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
                {account.transactions.map((tx) => {
                  const amount = Number(tx.amount);
                  const statusColour =
                    MATCH_STATUS_COLOURS[tx.matchStatus] ?? "#8888a0";

                  return (
                    <tr
                      key={tx.id}
                      className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-[var(--dpf-muted)] whitespace-nowrap">
                        {new Date(tx.transactionDate).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--dpf-text)] max-w-[200px] truncate">
                        {tx.description}
                      </td>
                      <td className="px-4 py-2.5">
                        {tx.reference && (
                          <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                            {tx.reference}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: statusColour,
                            backgroundColor: `${statusColour}20`,
                          }}
                        >
                          {tx.matchStatus.replace("_", " ")}
                        </span>
                      </td>
                      <td
                        className="px-4 py-2.5 text-right font-mono text-xs"
                        style={{ color: amount >= 0 ? "#4ade80" : "#ef4444" }}
                      >
                        {amount >= 0 ? "+" : ""}
                        {formatMoney(amount)}
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
