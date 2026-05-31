// apps/web/app/(shell)/admin/cockpit/CockpitEventsTable.tsx
//
// Client wrapper rendering the report-kit DataTable for the cockpit "Recent
// transmissions" evidence log — the one cockpit panel that benefits from sort
// (by torque / time) + pagination. The page (server component) pre-resolves the
// install-terminology labels and serializes flat rows; the bespoke gear
// diagnostic panels above remain hand-built per the cockpit spec (§5.4).

"use client";

import { DataTable, type Column } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import { formatTorque, torqueColor } from "@/lib/cockpit/cockpit-formatting";

export interface CockpitEventRow {
  id: string;
  recordedAtISO: string;
  interfaceLabel: string;
  capabilityLabel: string;
  capabilityName: string;
  sourceLabel: string;
  shaftSourceId: string;
  actorLabel: string;
  actorId: string;
  torqueTechnical: number;
  outcomeLabel: string;
  slipDetected: boolean;
  graderType: string;
}

const COLUMNS: Column<CockpitEventRow>[] = [
  {
    key: "when",
    header: "When",
    width: "72px",
    cell: (r) => (
      <span className="text-[var(--dpf-muted)] whitespace-nowrap">
        <LocalTime value={r.recordedAtISO} mode="time" />
      </span>
    ),
    sortAccessor: (r) => r.recordedAtISO,
  },
  {
    key: "ring",
    header: "Ring",
    width: "210px",
    cell: (r) => <span className="block truncate" title={r.interfaceLabel}>{r.interfaceLabel}</span>,
  },
  {
    key: "capability",
    header: "Capability",
    width: "230px",
    cell: (r) => <span className="block truncate" title={r.capabilityName}>{r.capabilityLabel}</span>,
    sortAccessor: (r) => r.capabilityLabel,
  },
  {
    key: "source",
    header: "Source",
    width: "220px",
    cell: (r) => (
      <div className="text-[var(--dpf-muted)]" title={r.shaftSourceId}>
        <div className="truncate">{r.sourceLabel}</div>
        <div className="text-[10px] truncate">unknown source route: {r.shaftSourceId}</div>
      </div>
    ),
  },
  {
    key: "actor",
    header: "Actor",
    width: "150px",
    cell: (r) => <span className="block truncate" title={r.actorId}>{r.actorLabel}</span>,
  },
  {
    key: "torque",
    header: "Torque",
    width: "82px",
    align: "right",
    cell: (r) => (
      <span className="font-semibold" style={{ color: torqueColor(r.torqueTechnical) }}>
        {formatTorque(r.torqueTechnical)}
      </span>
    ),
    sortAccessor: (r) => r.torqueTechnical,
  },
  {
    key: "outcome",
    header: "Outcome",
    width: "130px",
    cell: (r) =>
      r.slipDetected ? (
        <span style={{ color: "var(--dpf-error)" }}>{r.outcomeLabel}</span>
      ) : (
        <span>{r.outcomeLabel}</span>
      ),
  },
  {
    key: "grader",
    header: "Grader",
    width: "90px",
    cell: (r) => <span className="text-[var(--dpf-muted)]">{r.graderType}</span>,
  },
];

export function CockpitEventsTable({ rows }: { rows: CockpitEventRow[] }) {
  return (
    <div className="overflow-x-auto">
      <DataTable
        className="min-w-[1120px]"
        columns={COLUMNS}
        rows={rows}
        getRowKey={(r) => r.id}
        initialSort={{ key: "when", dir: "desc" }}
        pageSize={25}
        dense
        empty="No GearInterface records in the window."
      />
    </div>
  );
}
