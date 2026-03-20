// apps/web/app/(shell)/finance/invoices/new/page.tsx
import { prisma } from "@dpf/db";
import Link from "next/link";
import { CreateInvoiceForm } from "@/components/finance/CreateInvoiceForm";

export default async function NewInvoicePage() {
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
          className="text-xs text-[var(--dpf-muted)] hover:text-white"
        >
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/invoices"
          className="text-xs text-[var(--dpf-muted)] hover:text-white"
        >
          Invoices
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">New</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">New Invoice</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Create a draft invoice to send to a customer
        </p>
      </div>

      <CreateInvoiceForm customers={customers} />
    </div>
  );
}
