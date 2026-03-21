// apps/web/app/(shell)/finance/banking/[id]/reconcile/page.tsx
import { getTransactions, getReconciliationSummary } from "@/lib/actions/banking";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBankAccount } from "@/lib/actions/banking";
import { ReconciliationFeed } from "@/components/finance/ReconciliationFeed";
import { getCurrencySymbol } from "@/lib/currency-symbol";

type Props = { params: Promise<{ id: string }> };

export default async function ReconcilePage({ params }: Props) {
  const { id } = await params;

  const [account, summary, unmatchedTxs] = await Promise.all([
    getBankAccount(id),
    getReconciliationSummary(id),
    getTransactions(id, { matchStatus: "unmatched" }),
  ]);

  if (!account) notFound();

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
        <Link
          href={`/finance/banking/${id}`}
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          {account.name}
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Reconcile</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Reconcile</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{account.name}</p>
        </div>
        <Link
          href="/finance/banking/rules"
          className="text-xs text-[var(--dpf-accent)] hover:underline"
        >
          Bank Rules →
        </Link>
      </div>

      {unmatchedTxs.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm font-medium text-[var(--dpf-text)] mb-1" style={{ color: "#4ade80" }}>
            All caught up!
          </p>
          <p className="text-sm text-[var(--dpf-muted)] mb-4">
            All {summary.totalCount} transaction
            {summary.totalCount !== 1 ? "s" : ""} have been matched.
          </p>
          <Link
            href={`/finance/banking/${id}`}
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Back to account →
          </Link>
        </div>
      ) : (
        <ReconciliationFeed
          bankAccountId={id}
          initialTransactions={unmatchedTxs.map((tx) => ({
            id: tx.id,
            transactionDate: tx.transactionDate.toISOString(),
            description: tx.description,
            amount: Number(tx.amount),
            reference: tx.reference ?? null,
            matchStatus: tx.matchStatus,
          }))}
          totalCount={summary.totalCount}
          currencySymbol={getCurrencySymbol(account.currency)}
        />
      )}
    </div>
  );
}
