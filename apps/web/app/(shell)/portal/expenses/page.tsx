// apps/web/app/(shell)/portal/expenses/page.tsx
// Employee portal: list of the current user's own expense claims

import { listExpenseClaims } from "@/lib/actions/expenses";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "#a78bfa",
  approved: "#4ade80",
  rejected: "#ef4444",
  paid: "#22c55e",
};

export default async function MyExpensesPage() {
  const [claims, orgSettings] = await Promise.all([
    listExpenseClaims({ employeeOnly: true }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">My Expenses</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Your expense claims
          </p>
        </div>
        <Link
          href="/portal/expenses/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Expense Claim
        </Link>
      </div>

      {/* Claims list */}
      {claims.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-[var(--dpf-muted)]">No expense claims yet.</p>
          <Link
            href="/portal/expenses/new"
            className="mt-3 inline-block text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Submit your first expense claim →
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Claim ID
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Title
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Status
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Submitted
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => {
                const colour = STATUS_COLOURS[claim.status] ?? "#6b7280";
                return (
                  <tr
                    key={claim.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/portal/expenses/${claim.id}`}
                        className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                      >
                        {claim.claimId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/portal/expenses/${claim.id}`}
                        className="text-[var(--dpf-text)] hover:underline"
                      >
                        {claim.title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ color: colour, backgroundColor: `${colour}20` }}
                      >
                        {claim.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {claim.submittedAt
                        ? new Date(claim.submittedAt).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sym}{formatMoney(claim.totalAmount)}
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
