// apps/web/components/storefront/PublicLineItemsTable.tsx
// Client DataTable wrapper for public storefront approval / pay line items.
// Keeps server pages free of raw HTML table markup (BI-F7792FC1).

"use client";

import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";

export type PublicMoneyLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: string;
};

function formatMoney(currency: string, n: number): string {
  return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

const columns: Column<PublicMoneyLine>[] = [
  {
    key: "description",
    header: "Description",
    cell: (row) => row.description,
  },
  {
    key: "qty",
    header: "Qty",
    align: "right",
    cell: (row) => row.quantity,
  },
  {
    key: "price",
    header: "Price",
    align: "right",
    cell: (row) => formatMoney(row.currency, row.unitPrice),
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    cell: (row) => formatMoney(row.currency, row.lineTotal),
  },
];

export function PublicLineItemsTable({ rows }: { rows: PublicMoneyLine[] }) {
  return (
    <DataTable
      className="mb-8"
      columns={columns}
      dense
      getRowKey={(row) => row.id}
      rows={rows}
    />
  );
}
