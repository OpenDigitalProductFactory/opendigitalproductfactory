// apps/web/app/(shell)/finance/my-expenses/MyExpensesTable.tsx
//
// Client wrapper rendering the report-kit DataTable for the employee's own
// expense claims. The page (a Server Component) fetches + serializes rows.

"use client";


import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface MyExpenseRow {
  id: string;
  claimId: string;
  title: string;
  status: string;
  submittedAtISO: string | null;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function MyExpensesTable({
  rows,
  currencySymbol,
}: {
  rows: MyExpenseRow[];
  currencySymbol: string;
}) {
  // Claim id and title are text, not links. There is no claimant detail page
  // (/finance/my-expenses/[id] does not exist), and the manager view hands the
  // approval token to any viewer (BI-D43F1516). A row that cannot open is not
  // offered as a link (BI-235E9F00).
  const columns: Column<MyExpenseRow>[] = [
    {
      key: "claimId",
      header: "Claim ID",
      cell: (c) => (
        <span className="text-[9px] font-mono text-[var(--dpf-muted)]">{c.claimId}</span>
      ),
      sortAccessor: (c) => c.claimId,
    },
    {
      key: "title",
      header: "Title",
      cell: (c) => (
        <span className="text-[var(--dpf-text)]">{c.title}</span>
      ),
      sortAccessor: (c) => c.title,
    },
    {
      key: "status",
      header: "Status",
      cell: (c) => (
        <StatusBadge
          domain="financeExpenseClaim"
          status={c.status}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (c) => c.status,
    },
    {
      key: "submitted",
      header: "Submitted",
      cell: (c) => (
        <span className="text-[var(--dpf-muted)]">
          {c.submittedAtISO ? <LocalTime value={c.submittedAtISO} mode="date" /> : "—"}
        </span>
      ),
      sortAccessor: (c) => c.submittedAtISO ?? "",
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (c) => (
        <span className="text-[var(--dpf-text)]">
          {currencySymbol}
          {formatMoney(c.amount)}
        </span>
      ),
      sortAccessor: (c) => c.amount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((c) => ({
            claimId: c.claimId,
            title: c.title,
            status: c.status,
            total: c.amount,
          }))}
          columns={[
            { key: "claimId", header: "Claim ID" },
            { key: "title", header: "Title" },
            { key: "status", header: "Status" },
            { key: "total", header: "Total" },
          ]}
          filename="my-expenses.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(c) => c.id}
          empty="No expense claims yet."
        />
      </div>
    </div>
  );
}
