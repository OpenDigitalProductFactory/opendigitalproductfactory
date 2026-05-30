// apps/web/app/(shell)/finance/payments/page.tsx
import { prisma } from "@dpf/db";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { FilterBar } from "@/components/ui/report-kit";
import Link from "next/link";

import { PaymentsTable, type PaymentRow } from "./PaymentsTable";

type Props = { searchParams: Promise<{ direction?: string }> };

export default async function PaymentsPage({ searchParams }: Props) {
  const { direction } = await searchParams;

  const [payments, orgSettings] = await Promise.all([
    prisma.payment.findMany({
      ...(direction ? { where: { direction: direction.toLowerCase() } } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        allocations: {
          include: {
            invoice: {
              select: { id: true, invoiceRef: true },
            },
          },
        },
      },
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  // Serialize to plain rows for the client table (no Decimal/Date across the boundary).
  const rows: PaymentRow[] = payments.map((pmt) => {
    const linkedInvoice = pmt.allocations[0]?.invoice ?? null;
    return {
      id: pmt.id,
      paymentRef: pmt.paymentRef,
      method: pmt.method,
      direction: pmt.direction,
      invoiceId: linkedInvoice?.id ?? null,
      invoiceRef: linkedInvoice?.invoiceRef ?? null,
      dateISO: (pmt.receivedAt ?? pmt.createdAt).toISOString(),
      amount: Number(pmt.amount),
    };
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
        <span className="text-xs text-[var(--dpf-text)]">Payments</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Payments</h1>
      </div>

      <FinanceTabNav />

      {/* Direction filter — report-kit FilterBar in url mode (server-rendered) */}
      <div className="my-6">
        <FilterBar
          mode="url"
          basePath="/finance/payments"
          value={direction ? { direction: direction.toLowerCase() } : {}}
          facets={[
            {
              kind: "pills",
              key: "direction",
              label: "Direction",
              options: [
                { value: "inbound", label: "Inbound" },
                { value: "outbound", label: "Outbound" },
              ],
            },
          ]}
          resultCount={rows.length}
        />
      </div>

      {/* Payments table */}
      <PaymentsTable rows={rows} currencySymbol={sym} />
    </div>
  );
}
