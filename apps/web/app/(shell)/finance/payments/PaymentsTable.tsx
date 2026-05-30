// apps/web/app/(shell)/finance/payments/PaymentsTable.tsx
//
// Client wrapper that renders the report-kit DataTable for payments. The page
// (a Server Component) fetches + serializes rows and passes them here; DataTable
// needs a client boundary for sort/pagination, and its function-based columns
// can't cross the server→client boundary, so the columns live here.

"use client";

import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";

export interface PaymentRow {
  id: string;
  paymentRef: string;
  method: string;
  direction: string;
  invoiceId: string | null;
  invoiceRef: string | null;
  dateISO: string;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function PaymentsTable({
  rows,
  currencySymbol,
}: {
  rows: PaymentRow[];
  currencySymbol: string;
}) {
  const columns: Column<PaymentRow>[] = [
    { key: "ref", header: "Ref", cell: (p) => p.paymentRef, mono: true },
    {
      key: "method",
      header: "Method",
      cell: (p) => <span className="capitalize text-[var(--dpf-muted)]">{p.method}</span>,
      sortAccessor: (p) => p.method,
    },
    {
      key: "direction",
      header: "Direction",
      cell: (p) => (
        <StatusBadge domain="paymentDirection" status={p.direction} variant="soft" uppercase={false} />
      ),
      sortAccessor: (p) => p.direction,
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: (p) =>
        p.invoiceId ? (
          <Link
            href={`/finance/invoices/${p.invoiceId}`}
            className="font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          >
            {p.invoiceRef}
          </Link>
        ) : (
          <span className="text-[var(--dpf-muted)]">—</span>
        ),
    },
    {
      key: "date",
      header: "Date",
      cell: (p) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={p.dateISO} mode="date" />
        </span>
      ),
      sortAccessor: (p) => p.dateISO,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (p) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(p.amount)}
        </span>
      ),
      sortAccessor: (p) => p.amount,
    },
  ];

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] p-1">
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(p) => p.id}
        initialSort={{ key: "date", dir: "desc" }}
        empty="No payments found."
      />
    </div>
  );
}
