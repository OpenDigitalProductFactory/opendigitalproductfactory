// apps/web/app/(shell)/finance/my-expenses/new/page.tsx
// Employee portal: create a new expense claim

import Link from "next/link";
import { CreateExpenseForm } from "@/components/finance/CreateExpenseForm";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";

export default async function NewExpensePage() {
  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance/my-expenses"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          My Expenses
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New Claim</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">New Expense Claim</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Add your expenses and submit for approval.
        </p>
      </div>

      <CreateExpenseForm currencySymbol={sym} />
    </div>
  );
}
