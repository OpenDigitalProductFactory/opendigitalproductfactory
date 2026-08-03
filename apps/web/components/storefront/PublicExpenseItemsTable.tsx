// apps/web/components/storefront/PublicExpenseItemsTable.tsx
// Client DataTable wrapper for public expense-approval line items (BI-F7792FC1).

"use client";

import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";

export type PublicExpenseLine = {
  id: string;
  date: string | Date;
  categoryLabel: string;
  description: string;
  amount: number;
  currency: string;
};

function formatMoney(currency: string, n: number): string {
  return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
}

const columns: Column<PublicExpenseLine>[] = [
  {
    key: "date",
    header: "Date",
    cell: (row) => <LocalTime value={row.date} utc />,
  },
  {
    key: "category",
    header: "Category",
    cell: (row) => row.categoryLabel,
  },
  {
    key: "description",
    header: "Description",
    cell: (row) => row.description,
  },
  {
    key: "amount",
    header: "Amount",
    align: "right",
    cell: (row) => formatMoney(row.currency, row.amount),
  },
];

export function PublicExpenseItemsTable({ rows }: { rows: PublicExpenseLine[] }) {
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
