// apps/web/app/(shell)/compliance/posture/PostureTrendTable.tsx
//
// Client wrapper rendering the report-kit DataTable for compliance snapshot
// history. The page (server component) fetches + serializes rows and passes
// them here (DataTable needs a client boundary; its columns are functions).

"use client";

import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, StatusBadge, type Column } from "@/components/ui/report-kit";

import { scoreIntent } from "./posture-score";

export interface PostureSnapshotRow {
  snapshotId: string;
  takenAtISO: string;
  overallScore: number;
  coveredObligations: number;
  totalObligations: number;
  implementedControls: number;
  totalControls: number;
  openIncidents: number;
  overdueActions: number;
  triggeredBy: string;
}

const COLUMNS: Column<PostureSnapshotRow>[] = [
  {
    key: "date",
    header: "Date",
    cell: (s) => (
      <span className="text-[var(--dpf-text)]">
        <LocalTime value={s.takenAtISO} mode="date" />
      </span>
    ),
    sortAccessor: (s) => s.takenAtISO,
  },
  {
    key: "score",
    header: "Score",
    cell: (s) => (
      <StatusBadge intent={scoreIntent(s.overallScore)} label={String(s.overallScore)} variant="soft" />
    ),
    sortAccessor: (s) => s.overallScore,
  },
  {
    key: "obligations",
    header: "Obligations",
    cell: (s) => (
      <span className="text-[var(--dpf-muted)]">
        {s.coveredObligations}/{s.totalObligations}
      </span>
    ),
  },
  {
    key: "controls",
    header: "Controls",
    cell: (s) => (
      <span className="text-[var(--dpf-muted)]">
        {s.implementedControls}/{s.totalControls}
      </span>
    ),
  },
  {
    key: "incidents",
    header: "Incidents",
    align: "right",
    cell: (s) => <span className="text-[var(--dpf-muted)]">{s.openIncidents}</span>,
    sortAccessor: (s) => s.openIncidents,
  },
  {
    key: "overdue",
    header: "Overdue",
    align: "right",
    cell: (s) => <span className="text-[var(--dpf-muted)]">{s.overdueActions}</span>,
    sortAccessor: (s) => s.overdueActions,
  },
  {
    key: "trigger",
    header: "Trigger",
    cell: (s) => <span className="text-[var(--dpf-muted)]">{s.triggeredBy}</span>,
  },
];

export function PostureTrendTable({ rows }: { rows: PostureSnapshotRow[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={rows}
      getRowKey={(s) => s.snapshotId}
      initialSort={{ key: "date", dir: "desc" }}
      pageSize={12}
      empty="No snapshots yet."
    />
  );
}
