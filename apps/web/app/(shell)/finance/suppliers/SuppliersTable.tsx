// apps/web/app/(shell)/finance/suppliers/SuppliersTable.tsx
//
// Client wrapper rendering the report-kit DataTable for suppliers. The page
// (a Server Component) fetches + serializes rows and passes them here.

"use client";

import Link from "next/link";

import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface SupplierRow {
  id: string;
  supplierId: string;
  name: string;
  status: string;
  paymentTerms: string | null;
  billCount: number;
}

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  const columns: Column<SupplierRow>[] = [
    {
      key: "id",
      header: "ID",
      cell: (s) => (
        <Link
          href={`/finance/suppliers/${s.id}`}
          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {s.supplierId}
        </Link>
      ),
      sortAccessor: (s) => s.supplierId,
    },
    {
      key: "name",
      header: "Name",
      cell: (s) => (
        <Link
          href={`/finance/suppliers/${s.id}`}
          className="text-[var(--dpf-text)] hover:underline"
        >
          {s.name}
        </Link>
      ),
      sortAccessor: (s) => s.name,
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => (
        <StatusBadge
          domain="financeSupplier"
          status={s.status}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (s) => s.status,
    },
    {
      key: "paymentTerms",
      header: "Payment Terms",
      cell: (s) => <span className="text-[var(--dpf-muted)]">{s.paymentTerms}</span>,
      sortAccessor: (s) => s.paymentTerms ?? "",
    },
    {
      key: "bills",
      header: "Bills",
      align: "right",
      cell: (s) => <span className="text-[var(--dpf-muted)]">{s.billCount}</span>,
      sortAccessor: (s) => s.billCount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((s) => ({
            id: s.supplierId,
            name: s.name,
            status: s.status,
            paymentTerms: s.paymentTerms,
            bills: s.billCount,
          }))}
          columns={[
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "status", header: "Status" },
            { key: "paymentTerms", header: "Payment Terms" },
            { key: "bills", header: "Bills" },
          ]}
          filename="suppliers.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(s) => s.id}
          empty="No suppliers yet."
        />
      </div>
    </div>
  );
}
