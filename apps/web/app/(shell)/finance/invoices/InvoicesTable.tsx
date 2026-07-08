// apps/web/app/(shell)/finance/invoices/InvoicesTable.tsx
//
// Client wrapper rendering the report-kit DataTable for invoices. The page
// (a Server Component) fetches + serializes rows and passes them here; DataTable
// needs a client boundary for sort, and its function-based columns can't cross
// the server→client boundary, so the columns live here.

"use client";

import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface InvoiceRow {
  id: string;
  invoiceRef: string;
  accountName: string;
  status: string;
  dueDateISO: string;
  currencySymbol: string;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function InvoicesTable({ rows }: { rows: InvoiceRow[] }) {
  const columns: Column<InvoiceRow>[] = [
    {
      key: "ref",
      header: "Ref",
      cell: (inv) => (
        <Link
          href={`/finance/invoices/${inv.id}`}
          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {inv.invoiceRef}
        </Link>
      ),
      sortAccessor: (inv) => inv.invoiceRef,
    },
    {
      key: "account",
      header: "Account",
      cell: (inv) => (
        <Link
          href={`/finance/invoices/${inv.id}`}
          className="text-[var(--dpf-text)] hover:underline"
        >
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
      key: "dueDate",
      header: "Due Date",
      cell: (inv) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={inv.dueDateISO} utc />
        </span>
      ),
      sortAccessor: (inv) => inv.dueDateISO,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (inv) => (
        <span className="text-[var(--dpf-text)]">
          {inv.currencySymbol}
          {formatMoney(inv.amount)}
        </span>
      ),
      sortAccessor: (inv) => inv.amount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((inv) => ({
            ref: inv.invoiceRef,
            account: inv.accountName,
            status: inv.status,
            amount: inv.amount,
          }))}
          columns={[
            { key: "ref", header: "Ref" },
            { key: "account", header: "Account" },
            { key: "status", header: "Status" },
            { key: "amount", header: "Amount" },
          ]}
          filename="invoices.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(inv) => inv.id}
          empty="No invoices found."
        />
      </div>
    </div>
  );
}
