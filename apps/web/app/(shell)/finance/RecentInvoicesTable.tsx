// apps/web/app/(shell)/finance/RecentInvoicesTable.tsx
//
// Client wrapper rendering the report-kit DataTable for the finance home
// "Recent Invoices" list. The page (server component) serializes rows and
// passes them down.

"use client";

import Link from "next/link";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";

export interface RecentInvoiceRow {
  id: string;
  invoiceRef: string;
  accountName: string;
  status: string;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function RecentInvoicesTable({
  rows,
  currencySymbol,
}: {
  rows: RecentInvoiceRow[];
  currencySymbol: string;
}) {
  const columns: Column<RecentInvoiceRow>[] = [
    {
      key: "ref",
      header: "Ref",
      mono: true,
      cell: (inv) => (
        <Link
          href={`/finance/invoices/${inv.id}`}
          className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {inv.invoiceRef}
        </Link>
      ),
    },
    {
      key: "account",
      header: "Account",
      cell: (inv) => (
        <Link href={`/finance/invoices/${inv.id}`} className="text-[var(--dpf-text)] hover:underline">
          {inv.accountName}
        </Link>
      ),
      sortAccessor: (inv) => inv.accountName,
    },
    {
      key: "status",
      header: "Status",
      cell: (inv) => (
        <StatusBadge
          domain="finance"
          status={inv.status}
          label={inv.status.replace("_", " ")}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (inv) => inv.status,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (inv) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(inv.amount)}
        </span>
      ),
      sortAccessor: (inv) => inv.amount,
    },
  ];

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] p-1">
      <DataTable columns={columns} rows={rows} getRowKey={(inv) => inv.id} empty="No invoices yet." />
    </div>
  );
}
