// apps/web/app/(shell)/finance/payment-runs/PaymentRunsTable.tsx
//
// Client wrapper rendering the report-kit DataTable for past payment runs.
// The page (a Server Component) fetches + serializes rows and passes them here.
// The "New Payment Run" builder above the list stays in the page unchanged.

"use client";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export interface PaymentRunRow {
  id: string;
  paymentRef: string;
  receivedAtISO: string | null;
  status: string;
  billCount: number;
  currency: string;
  amount: number;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function PaymentRunsTable({ rows }: { rows: PaymentRunRow[] }) {
  const columns: Column<PaymentRunRow>[] = [
    {
      key: "paymentRef",
      header: "Payment Ref",
      cell: (run) => (
        <span className="text-[9px] font-mono text-[var(--dpf-muted)]">
          {run.paymentRef}
        </span>
      ),
      sortAccessor: (run) => run.paymentRef,
    },
    {
      key: "date",
      header: "Date",
      cell: (run) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={run.receivedAtISO} mode="date" />
        </span>
      ),
      sortAccessor: (run) => run.receivedAtISO ?? "",
    },
    {
      key: "status",
      header: "Status",
      cell: (run) => (
        <StatusBadge
          domain="financePaymentRun"
          status={run.status}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (run) => run.status,
    },
    {
      key: "bills",
      header: "Bills",
      align: "right",
      cell: (run) => <span className="text-[var(--dpf-muted)]">{run.billCount}</span>,
      sortAccessor: (run) => run.billCount,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (run) => (
        <span className="text-[var(--dpf-text)]">
          {run.currency} {formatMoney(run.amount)}
        </span>
      ),
      sortAccessor: (run) => run.amount,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((run) => ({
            paymentRef: run.paymentRef,
            status: run.status,
            bills: run.billCount,
            amount: run.amount,
          }))}
          columns={[
            { key: "paymentRef", header: "Payment Ref" },
            { key: "status", header: "Status" },
            { key: "bills", header: "Bills" },
            { key: "amount", header: "Amount" },
          ]}
          filename="payment-runs.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(run) => run.id}
          empty="No payment runs yet."
        />
      </div>
    </div>
  );
}
