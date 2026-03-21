// apps/web/app/(shell)/portal/expenses/new/page.tsx
// Employee portal: create a new expense claim

import Link from "next/link";
import { CreateExpenseForm } from "@/components/finance/CreateExpenseForm";

export default async function NewExpensePage() {
  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/portal/expenses"
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

      <CreateExpenseForm />
    </div>
  );
}
