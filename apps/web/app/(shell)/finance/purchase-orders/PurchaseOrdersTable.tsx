// apps/web/app/(shell)/finance/purchase-orders/PurchaseOrdersTable.tsx
//
// Client wrapper rendering the report-kit DataTable for purchase orders. The
// page (a Server Component) fetches + serializes rows and passes them here.

"use client";

import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  deliveryDateISO: string | null;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function PurchaseOrdersTable({
  rows,
  currencySymbol,
}: {
  rows: PurchaseOrderRow[];
  currencySymbol: string;
}) {
  const columns: Column<PurchaseOrderRow>[] = [
    {
      key: "poNumber",
      header: "PO Number",
      cell: (po) => (
        <Link
          href={`/finance/purchase-orders/${po.id}`}
          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
        >
          {po.poNumber}
        </Link>
      ),
      sortAccessor: (po) => po.poNumber,
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (po) => (
        <Link
          href={`/finance/purchase-orders/${po.id}`}
          className="text-[var(--dpf-text)] hover:underline"
        >
          {po.supplierName}
        </Link>
      ),
      sortAccessor: (po) => po.supplierName,
    },
    {
      key: "status",
      header: "Status",
      cell: (po) => (
        <StatusBadge
          domain="financePurchaseOrder"
          status={po.status}
          label={po.status.replace(/_/g, " ")}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (po) => po.status,
    },
    {
      key: "deliveryDate",
      header: "Delivery Date",
      cell: (po) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={po.deliveryDateISO} utc />
        </span>
      ),
      sortAccessor: (po) => po.deliveryDateISO ?? "",
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (po) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(po.amount)}
        </span>
      ),
      sortAccessor: (po) => po.amount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((po) => ({
            poNumber: po.poNumber,
            supplier: po.supplierName,
            status: po.status,
            total: po.amount,
          }))}
          columns={[
            { key: "poNumber", header: "PO Number" },
            { key: "supplier", header: "Supplier" },
            { key: "status", header: "Status" },
            { key: "total", header: "Total" },
          ]}
          filename="purchase-orders.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(po) => po.id}
          empty="No purchase orders found."
        />
      </div>
    </div>
  );
}
