"use client";

// Decision-ledger table for /wiki/decisions. Server page fetches the rows;
// this client child composes the report-kit DataTable per its server-page →
// client-table contract.

import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type { DecisionAuditRow } from "@/lib/wiki/decision-audit";

const columns: Column<DecisionAuditRow>[] = [
  {
    key: "createdAt",
    header: "When",
    cell: (r) => <LocalTime value={r.createdAt} />,
    sortAccessor: (r) => r.createdAt,
  },
  {
    key: "tier",
    header: "Tier",
    cell: (r) => (
      <StatusBadge
        intent={r.tier === "wwmd" ? "info" : r.tier === "wwwd" ? "accent" : "neutral"}
        label={r.tierCode}
        variant="soft"
      />
    ),
    sortAccessor: (r) => r.tierCode,
  },
  {
    key: "question",
    header: "Decision",
    cell: (r) => (
      <span className="block max-w-md truncate" title={r.question}>
        {r.question || "—"}
      </span>
    ),
  },
  {
    key: "outcome",
    header: "Outcome",
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge domain="decisionOutcome" status={r.outcomeType} />
        {r.awaitingHuman ? (
          <StatusBadge intent="warning" label="awaiting review" variant="soft" />
        ) : null}
      </span>
    ),
    sortAccessor: (r) => r.outcomeType,
  },
  {
    key: "recommended",
    header: "Recommended",
    cell: (r) => (
      <span className="block max-w-[10rem] truncate" title={r.recommendedOptionId ?? undefined}>
        {r.recommendedOptionId ?? "—"}
      </span>
    ),
  },
  {
    key: "risk",
    header: "Risk",
    cell: (r) => <StatusBadge domain="decisionRisk" status={r.riskTier} variant="soft" />,
    sortAccessor: (r) => r.riskTier,
  },
  {
    key: "conflict",
    header: "Conflict",
    cell: (r) =>
      r.principleConflict ? (
        <StatusBadge intent="danger" label="principle conflict" variant="soft" />
      ) : (
        <span className="text-[var(--dpf-muted)]">—</span>
      ),
    sortAccessor: (r) => (r.principleConflict ? 1 : 0),
  },
  {
    key: "caller",
    header: "Caller",
    cell: (r) => (
      <span
        className="block max-w-[11rem] truncate"
        title={r.callerThreadId ? `${r.callerLabel} · thread ${r.callerThreadId}` : r.callerLabel}
      >
        {r.callerLabel}
        {r.callerThreadId ? (
          <span className="text-[var(--dpf-muted)]"> · {r.callerThreadId.slice(0, 8)}</span>
        ) : null}
      </span>
    ),
    sortAccessor: (r) => r.callerLabel,
  },
  {
    key: "where",
    header: "Where",
    cell: (r) => (
      <span className="block max-w-[10rem] truncate text-[var(--dpf-muted)]" title={r.routeContext}>
        {r.routeContext}
      </span>
    ),
  },
];

export function DecisionAuditTable({ rows }: { rows: DecisionAuditRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.interactionId}
      rowHref={(r) => `/wiki/decisions/${r.interactionId}`}
      initialSort={{ key: "createdAt", dir: "desc" }}
      pageSize={25}
      empty="No decisions recorded yet for this view."
    />
  );
}
