// apps/web/app/(shell)/finance/expense-claims/page.tsx
// Manager view: all expense claims with status filter and pending count

import { listExpenseClaims } from "@/lib/actions/expenses";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { PlatformGridSection, parseSurfaceView } from "@/components/workbooks/PlatformGridSection";
import Link from "next/link";
import { ExpenseClaimsTable, type ExpenseClaimRow } from "./ExpenseClaimsTable";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "#a78bfa",
  approved: "#4ade80",
  rejected: "#ef4444",
  paid: "#22c55e",
};

const ALL_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"];

type Props = { searchParams: Promise<{ status?: string; view?: string }> };

export default async function ExpenseClaimsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { status } = sp;
  const view = parseSurfaceView(sp.view);

  const [claims, orgSettings] = await Promise.all([
    listExpenseClaims({ ...(status ? { status } : {}) }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const pendingCount = status
    ? 0
    : claims.filter((c) => c.status === "submitted").length;

  const rows: ExpenseClaimRow[] = claims.map((claim) => ({
    id: claim.id,
    claimId: claim.claimId,
    employeeName: claim.employee.displayName,
    title: claim.title,
    status: claim.status,
    submittedAtISO: claim.submittedAt ? new Date(claim.submittedAt).toISOString() : null,
    amount: Number(claim.totalAmount),
  }));

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

      <PlatformGridSection entityType="expense_claim" view={view} />

      {!view && (<>
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
      <ExpenseClaimsTable rows={rows} currencySymbol={sym} />
      </>)}
    </div>
  );
}
