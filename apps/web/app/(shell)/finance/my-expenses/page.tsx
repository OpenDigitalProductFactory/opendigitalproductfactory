// apps/web/app/(shell)/finance/my-expenses/page.tsx
// Employee portal: list of the current user's own expense claims

import { listExpenseClaims } from "@/lib/actions/expenses";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import Link from "next/link";
import { MyExpensesTable, type MyExpenseRow } from "./MyExpensesTable";

export default async function MyExpensesPage() {
  const [claims, orgSettings] = await Promise.all([
    listExpenseClaims({ employeeOnly: true }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const rows: MyExpenseRow[] = claims.map((claim) => ({
    id: claim.id,
    claimId: claim.claimId,
    title: claim.title,
    status: claim.status,
    submittedAtISO: claim.submittedAt ? new Date(claim.submittedAt).toISOString() : null,
    amount: Number(claim.totalAmount),
  }));

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
          href="/finance/my-expenses/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Expense Claim
        </Link>
      </div>

      <FinanceTabNav />

      {/* Claims list */}
      {claims.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-[var(--dpf-muted)]">No expense claims yet.</p>
          <Link
            href="/finance/my-expenses/new"
            className="mt-3 inline-block text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Submit your first expense claim →
          </Link>
        </div>
      ) : (
        <MyExpensesTable rows={rows} currencySymbol={sym} />
      )}
    </div>
  );
}
