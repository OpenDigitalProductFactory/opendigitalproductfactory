"use client";

import type { ContributionProvenanceAxis, ContributionProvenanceRow } from "@/lib/actions/hive-contributions";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

function AxisBadge({ axis }: { axis: ContributionProvenanceAxis }) {
  return (
    <div className="min-w-36">
      <StatusBadge
        domain="contributionProvenance"
        status={axis.status}
        label={axis.label}
        uppercase={false}
        variant="soft"
      />
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">{axis.detail}</p>
      {axis.url ? (
        <a
          href={axis.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-[var(--dpf-accent)] hover:underline"
        >
          Open contribution
        </a>
      ) : null}
    </div>
  );
}

const columns: Column<ContributionProvenanceRow>[] = [
  {
    key: "item",
    header: "Item",
    cell: (row) => (
      <div className="min-w-48">
        <p className="font-medium text-[var(--dpf-text)]">{row.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)]">{row.sourceLabel}</p>
      </div>
    ),
    sortAccessor: (row) => row.title,
  },
  {
    key: "kept-here",
    header: "Kept here",
    cell: (row) => <AxisBadge axis={row.localAvailability} />,
    sortAccessor: (row) => row.localAvailability.label,
  },
  {
    key: "privacy",
    header: "Privacy",
    cell: (row) => <AxisBadge axis={row.privacyDisposition} />,
    sortAccessor: (row) => row.privacyDisposition.label,
  },
  {
    key: "sent-outside",
    header: "Sent outside",
    cell: (row) => <AxisBadge axis={row.publication} />,
    sortAccessor: (row) => row.publication.label,
  },
  {
    key: "community-status",
    header: "Community status",
    cell: (row) => <AxisBadge axis={row.upstreamAcceptance} />,
    sortAccessor: (row) => row.upstreamAcceptance.label,
  },
];

export function ContributionProvenanceTable({ rows }: { rows: ContributionProvenanceRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--dpf-border)]">
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        initialSort={{ key: "sent-outside", dir: "asc" }}
        pageSize={20}
        empty={(
          <EmptyState
            title="No contribution provenance yet"
            description="Features and learnings will appear here once they are kept locally, privately backed up, or shared with the community."
            size="sm"
            bordered={false}
          />
        )}
      />
    </div>
  );
}
