"use client";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";

export interface ServiceTicketRow {
  ticketId: string;
  ticketKind: string;
  status: string;
  priority: string;
  title: string;
  customerName: string | null;
  scopeKey: string | null;
  openedAtISO: string;
}

const COLUMNS: Column<ServiceTicketRow>[] = [
  {
    key: "ticketId",
    header: "Ticket",
    width: "120px",
    cell: (r) => <span className="font-mono text-xs text-[var(--dpf-muted)]">{r.ticketId}</span>,
    sortAccessor: (r) => r.ticketId,
  },
  {
    key: "kind",
    header: "Kind",
    width: "110px",
    cell: (r) => <span className="text-[var(--dpf-muted)]">{r.ticketKind}</span>,
    sortAccessor: (r) => r.ticketKind,
  },
  {
    key: "status",
    header: "Status",
    width: "140px",
    cell: (r) => <StatusBadge domain="serviceTicketStatus" status={r.status} />,
    sortAccessor: (r) => r.status,
  },
  {
    key: "priority",
    header: "Priority",
    width: "100px",
    cell: (r) => <StatusBadge domain="serviceTicketPriority" status={r.priority} />,
    sortAccessor: (r) => r.priority,
  },
  {
    key: "customer",
    header: "Customer",
    width: "170px",
    cell: (r) => (
      <span className="block truncate" title={r.customerName ?? "Internal estate"}>
        {r.customerName ?? <span className="text-[var(--dpf-muted)]">Internal estate</span>}
      </span>
    ),
    sortAccessor: (r) => r.customerName ?? "",
  },
  {
    key: "title",
    header: "Title",
    cell: (r) => (
      <span className="block truncate text-[var(--dpf-text)]" title={r.title}>
        {r.title}
      </span>
    ),
  },
  {
    key: "opened",
    header: "Opened",
    width: "160px",
    cell: (r) => (
      <span className="whitespace-nowrap text-[var(--dpf-muted)]">
        {new Date(r.openedAtISO).toLocaleString()}
      </span>
    ),
    sortAccessor: (r) => r.openedAtISO,
  },
];

export function ServiceTicketsTable({ rows }: { rows: ServiceTicketRow[] }) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        className="min-w-[920px]"
        columns={COLUMNS}
        rows={rows}
        getRowKey={(r) => r.ticketId}
        initialSort={{ key: "opened", dir: "desc" }}
        pageSize={25}
        dense
        empty="No service tickets yet. Incident tickets are created from correlated edge events once the correlation job is enabled."
      />
    </div>
  );
}
