// apps/web/app/(shell)/finance/recurring/RecurringTable.tsx
//
// Client wrapper rendering the report-kit DataTable for recurring schedules.
// The page (a Server Component) fetches + serializes rows and passes them here.

"use client";

import Link from "next/link";

import { LocalTime } from "@/components/ui/LocalTime";
import {
  DataTable,
  ExportButton,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

export interface RecurringRow {
  id: string;
  scheduleId: string;
  name: string;
  customerName: string;
  frequency: string;
  currency: string;
  amount: number;
  nextInvoiceDateISO: string;
  status: string;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });
}

export function RecurringTable({ rows }: { rows: RecurringRow[] }) {
  const columns: Column<RecurringRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (s) => (
        <div>
          <Link
            href={`/finance/recurring/${s.id}`}
            className="text-[var(--dpf-text)] hover:underline font-medium"
          >
            {s.name}
          </Link>
          <div className="text-[9px] font-mono text-[var(--dpf-muted)] mt-0.5">
            {s.scheduleId}
          </div>
        </div>
      ),
      sortAccessor: (s) => s.name,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (s) => <span className="text-[var(--dpf-muted)]">{s.customerName}</span>,
      sortAccessor: (s) => s.customerName,
    },
    {
      key: "frequency",
      header: "Frequency",
      cell: (s) => (
        <StatusBadge
          intent="info"
          label={FREQUENCY_LABELS[s.frequency] ?? s.frequency}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (s) => s.frequency,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (s) => (
        <span className="text-[var(--dpf-text)]">
          {s.currency} {formatMoney(s.amount)}
        </span>
      ),
      sortAccessor: (s) => s.amount,
    },
    {
      key: "nextInvoice",
      header: "Next Invoice",
      cell: (s) => (
        <span className="text-[var(--dpf-muted)]">
          <LocalTime value={s.nextInvoiceDateISO} utc />
        </span>
      ),
      sortAccessor: (s) => s.nextInvoiceDateISO,
    },
    {
      key: "status",
      header: "Status",
      cell: (s) => (
        <StatusBadge
          domain="financeRecurring"
          status={s.status}
          variant="soft"
          uppercase={false}
        />
      ),
      sortAccessor: (s) => s.status,
    },
  ];

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <ExportButton
          rows={rows.map((s) => ({
            name: s.name,
            scheduleId: s.scheduleId,
            customer: s.customerName,
            frequency: s.frequency,
            amount: s.amount,
            status: s.status,
          }))}
          columns={[
            { key: "name", header: "Name" },
            { key: "scheduleId", header: "Schedule ID" },
            { key: "customer", header: "Customer" },
            { key: "frequency", header: "Frequency" },
            { key: "amount", header: "Amount" },
            { key: "status", header: "Status" },
          ]}
          filename="recurring-schedules.csv"
        />
      </div>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(s) => s.id}
          empty="No recurring schedules found."
        />
      </div>
    </div>
  );
}
