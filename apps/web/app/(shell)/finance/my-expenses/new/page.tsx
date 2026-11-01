// apps/web/app/(shell)/finance/my-expenses/new/page.tsx
// Employee portal: create a new expense claim

import Link from "next/link";
import { CreateExpenseForm } from "@/components/finance/CreateExpenseForm";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { prisma } from "@dpf/db";
import { requireUser } from "@/lib/actions/shared/guards";
import { getT } from "@/lib/i18n/t.server";
import { Surface } from "@/components/ui/Surface";

export default async function NewExpensePage() {
  const t = await getT("shell");
  const user = await requireUser();
  const employeeProfile = await prisma.employeeProfile.findFirst({
    where: { userId: user.id },
    select: { id: true },
  });
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
          {t("finance.expenseEntrySummary")}
        </p>
        <details className="mt-2 text-sm text-[var(--dpf-muted)]">
          <summary className="cursor-pointer">{t("finance.expenseEntryHelp")}</summary>
          <p className="mt-2">{t("finance.expenseEntryDetails")}</p>
        </details>
      </div>

      {employeeProfile ? (
        <CreateExpenseForm currencySymbol={sym} />
      ) : (
        <Surface className="p-4">
          <p className="text-sm text-[var(--dpf-text)]">
            {t("finance.expenseProfileRequired")}
          </p>
          <Link href="/employee" className="mt-3 inline-block text-sm text-[var(--dpf-accent)] hover:underline">
            {t("finance.openPeople")}
          </Link>
        </Surface>
      )}
    </div>
  );
}
