"use client";

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import { LocalTime } from "@/components/ui/LocalTime";
import type { BrowserSessionLedgerRow } from "@/lib/browser-drive/ledger";

// Status → semantic intent (the ledger is browser-driving-specific, so the map
// lives here rather than in the shared statusColors registry).
const STATUS_INTENT: Record<string, Intent> = {
  active: "info",
  closed: "neutral",
  failed: "danger",
  "blocked-on-reauth": "warning",
};

// Operator-facing labels — never raw tool/means ids in primary copy (§10.2).
const MEANS_LABEL: Record<string, string> = {
  plugin: "Plugin",
  deterministic: "Deterministic",
  delegated: "Delegated",
};

function statusLabel(status: string): string {
  return status.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const columns: Column<BrowserSessionLedgerRow>[] = [
  {
    key: "session",
    header: "Session",
    cell: (row) => row.sessionId,
    mono: true,
    sortAccessor: (row) => row.sessionId,
  },
  {
    key: "means",
    header: "Means",
    cell: (row) => MEANS_LABEL[row.means] ?? row.means,
    sortAccessor: (row) => row.means,
  },
  {
    key: "profile",
    header: "Profile",
    cell: (row) => (
      <span className="text-[var(--dpf-text)]">
        {row.profileKind === "operator-live" ? "Operator-live" : "Service account"}
        {row.attended ? (
          <span className="ml-2 text-xs text-[var(--dpf-muted)]">attended</span>
        ) : null}
      </span>
    ),
    sortAccessor: (row) => row.profileKind,
  },
  {
    key: "domains",
    header: "Target domains",
    cell: (row) =>
      row.targetDomains.length ? (
        <span className="text-[var(--dpf-text)]">{row.targetDomains.join(", ")}</span>
      ) : (
        <span className="text-[var(--dpf-muted)]">unrestricted</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (row) => (
      <StatusBadge intent={STATUS_INTENT[row.status] ?? "neutral"} label={statusLabel(row.status)} />
    ),
    sortAccessor: (row) => row.status,
  },
  {
    key: "for",
    header: "For",
    cell: (row) => <span className="text-[var(--dpf-muted)]">{row.delegatingUserId}</span>,
    sortAccessor: (row) => row.delegatingUserId,
  },
  {
    key: "started",
    header: "Started",
    cell: (row) => <LocalTime value={row.startedAt} />,
    sortAccessor: (row) => row.startedAt,
  },
];

export function BrowserSessionLedgerTable({ rows }: { rows: BrowserSessionLedgerRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.sessionId}
      initialSort={{ key: "started", dir: "desc" }}
      pageSize={25}
      empty={
        <span className="text-[var(--dpf-muted)]">
          No browser-driving sessions yet. Provision a service account to begin.
        </span>
      }
    />
  );
}
