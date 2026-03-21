// apps/web/app/(shell)/finance/banking/page.tsx
import { listBankAccounts } from "@/lib/actions/banking";
import Link from "next/link";
import { getCurrencySymbol } from "@/lib/currency-symbol";

export default async function BankingPage() {
  const accounts = await listBankAccounts();

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  const maskAccountNumber = (accountNumber: string | null) => {
    if (!accountNumber) return null;
    const last4 = accountNumber.slice(-4);
    return `****${last4}`;
  };

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
        <span className="text-xs text-[var(--dpf-text)]">Banking</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Banking</h1>
        <Link
          href="/finance/banking/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          Add Bank Account
        </Link>
      </div>

      {/* Accounts */}
      {accounts.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[var(--dpf-muted)] mb-3">
            No bank accounts yet. Add your first account to start reconciling transactions.
          </p>
          <Link
            href="/finance/banking/new"
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Add Bank Account →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map((account) => {
            const balance = Number(account.currentBalance);
            const unmatched = account._count.transactions;
            const masked = maskAccountNumber(account.accountNumber);

            return (
              <Link
                key={account.id}
                href={`/finance/banking/${account.id}`}
                className="block p-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)] group-hover:text-[var(--dpf-accent)] transition-colors">
                      {account.name}
                    </p>
                    {account.bankName && (
                      <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
                        {account.bankName}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {unmatched > 0 && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ color: "#fbbf24", backgroundColor: "#fbbf2420" }}
                      >
                        {unmatched} unmatched
                      </span>
                    )}
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ color: "#8888a0", backgroundColor: "#8888a020" }}
                    >
                      {account.currency}
                    </span>
                  </div>
                </div>

                <div className="mb-3">
                  <p
                    className="text-2xl font-bold"
                    style={{ color: balance >= 0 ? "#4ade80" : "#ef4444" }}
                  >
                    {balance < 0 ? "-" : ""}
                    {getCurrencySymbol(account.currency)}{" "}
                    {formatMoney(Math.abs(balance))}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {masked && (
                      <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
                        {masked}
                      </span>
                    )}
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ color: "#8888a0", backgroundColor: "#8888a020" }}
                    >
                      {account.accountType.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-[9px] text-[var(--dpf-muted)]">
                    {account.lastReconciledAt
                      ? `Reconciled ${new Date(account.lastReconciledAt).toLocaleDateString("en-GB")}`
                      : "Never reconciled"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
