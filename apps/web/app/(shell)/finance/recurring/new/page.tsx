// apps/web/app/(shell)/finance/recurring/new/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateRecurringForm } from "@/components/finance/CreateRecurringForm";

export default async function NewRecurringPage() {
  const customers = await prisma.customerAccount.findMany({
    where: {
      status: { in: ["active", "prospect", "qualified", "onboarding"] },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      accountId: true,
      name: true,
      currency: true,
    },
  });

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
          href="/finance/recurring"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Recurring
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">New</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          New Recurring Schedule
        </h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Create a recurring billing schedule to automate invoice generation
        </p>
      </div>

      <CreateRecurringForm customers={customers} />
    </div>
  );
}
