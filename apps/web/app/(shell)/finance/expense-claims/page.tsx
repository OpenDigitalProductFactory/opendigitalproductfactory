// apps/web/app/(shell)/finance/expense-claims/page.tsx
// Manager view: all expense claims with status filter and pending count

import { listExpenseClaims } from "@/lib/actions/expenses";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "#a78bfa",
  approved: "#4ade80",
  rejected: "#ef4444",
  paid: "#22c55e",
};

const ALL_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"];

type Props = { searchParams: Promise<{ status?: string }> };

export default async function ExpenseClaimsPage({ searchParams }: Props) {
  const { status } = await searchParams;

  const [claims, orgSettings] = await Promise.all([
    listExpenseClaims({ ...(status ? { status } : {}) }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const pendingCount = status
    ? 0
    : claims.filter((c) => c.status === "submitted").length;

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Expense Claims</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Expense Claims</h1>
      </div>

      <FinanceTabNav />

      {/* Pending approval alert */}
      {pendingCount > 0 && (
        <div
          className="mb-6 p-4 rounded-lg border flex items-center gap-3"
          style={{
            borderColor: "#a78bfa40",
            backgroundColor: "#a78bfa10",
          }}
        >
          <span
            className="text-2xl font-bold"
            style={{ color: "#a78bfa" }}
          >
            {pendingCount}
          </span>
          <div>
            <p className="text-sm font-medium text-[var(--dpf-text)]">
              claim{pendingCount !== 1 ? "s" : ""} awaiting approval
            </p>
            <Link
              href="/finance/expense-claims?status=submitted"
              className="text-xs hover:underline"
              style={{ color: "#a78bfa" }}
            >
              View pending →
            </Link>
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/expense-claims"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#6b7280";
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/finance/expense-claims?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Claims table */}
      {claims.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No expense claims found.</p>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Claim ID
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Employee
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
                        href={`/finance/expense-claims/${claim.id}`}
                        className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                      >
                        {claim.claimId}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                      {claim.employee.displayName}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/expense-claims/${claim.id}`}
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
