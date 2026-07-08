// apps/web/app/(shell)/finance/bills/BillsTable.tsx
//
// Client wrapper rendering the report-kit DataTable for AP bills. The page
// (a Server Component) fetches + serializes rows and passes them here.

"use client";

import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface BillRow {
  id: string;
  billRef: string;
  supplierName: string;
  status: string;
  dueDateISO: string;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function BillsTable({
  rows,
  currencySymbol,
}: {
  rows: BillRow[];
  currencySymbol: string;
}) {
  const columns: Column<BillRow>[] = [
    {
      key: "ref",
      header: "Ref",
      cell: (bill) => (
        <Link
          href={`/finance/bills/${bill.id}`}
          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {bill.billRef}
        </Link>
      ),
      sortAccessor: (bill) => bill.billRef,
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (bill) => (
        <Link
          href={`/finance/bills/${bill.id}`}
          className="text-[var(--dpf-text)] hover:underline"
        >
          {bill.supplierName}
        </Link>
      ),
      sortAccessor: (bill) => bill.supplierName,
    },
    {
      key: "status",
      header: "Status",
      cell: (bill) => (
        <StatusBadge
          domain="financeBill"
          status={bill.status}
          label={bill.status.replace(/_/g, " ")}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (bill) => bill.status,
    },
    {
      key: "dueDate",
      header: "Due Date",
      cell: (bill) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={bill.dueDateISO} utc />
        </span>
      ),
      sortAccessor: (bill) => bill.dueDateISO,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (bill) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(bill.amount)}
        </span>
      ),
      sortAccessor: (bill) => bill.amount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((bill) => ({
            ref: bill.billRef,
            supplier: bill.supplierName,
            status: bill.status,
            amount: bill.amount,
          }))}
          columns={[
            { key: "ref", header: "Ref" },
            { key: "supplier", header: "Supplier" },
            { key: "status", header: "Status" },
            { key: "amount", header: "Amount" },
          ]}
          filename="bills.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(bill) => bill.id}
          empty="No bills found."
        />
      </div>
    </div>
  );
}
