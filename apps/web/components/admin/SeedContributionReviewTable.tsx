"use client";

import type { SeedContributionReviewRow } from "@/lib/actions/hive-contributions";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

const DECISION_LABELS: Record<string, string> = {
  "global-default": "Global default",
  "archetype-scoped": "Archetype scoped",
  "vertical-scoped": "Vertical scoped",
  "parameterize-first": "Parameterize first",
  "install-local-only": "Install local only",
  "reject-as-seed": "Reject as seed",
};

function scopeLabel(row: SeedContributionReviewRow): string {
  if (row.decision === "global-default") return "All installs";
  if (row.applicableScope.length > 0) return row.applicableScope.join(", ");
  if (row.decision === "install-local-only") return "Contributing install";
  return "Not approved for distribution";
}

const columns: Column<SeedContributionReviewRow>[] = [
  {
    key: "contribution",
    header: "Contribution",
    cell: (row) => (
      <div className="min-w-40">
        <p className="font-medium text-[var(--dpf-text)]">{row.title}</p>
        <p className="font-mono text-[10px] text-[var(--dpf-muted)]">{row.packId}</p>
      </div>
    ),
    sortAccessor: (row) => row.title,
  },
  {
    key: "decision",
    header: "Seed fit",
    cell: (row) => row.decision ? (
      <StatusBadge
        domain="seedContributionFit"
        status={row.decision}
        label={DECISION_LABELS[row.decision] ?? row.decision}
        uppercase={false}
        variant="soft"
      />
    ) : (
      <StatusBadge intent="warning" label="Review required" uppercase={false} variant="soft" />
    ),
    sortAccessor: (row) => row.decision ?? "review-required",
  },
  {
    key: "scope",
    header: "Applies to",
    cell: (row) => <span className="text-[var(--dpf-text)]">{scopeLabel(row)}</span>,
  },
  {
    key: "paths",
    header: "Seed paths",
    cell: (row) => (
      <span className="text-[var(--dpf-text)]" title={row.changedSeedPaths.join("\n")}>
        {row.changedSeedPaths.length}
      </span>
    ),
    align: "right",
    sortAccessor: (row) => row.changedSeedPaths.length,
  },
  {
    key: "rationale",
    header: "Why",
    cell: (row) => <p className="max-w-md text-[var(--dpf-muted)]">{row.rationale}</p>,
  },
  {
    key: "reviewed",
    header: "Reviewed",
    cell: (row) => (
      <div className="whitespace-nowrap text-[var(--dpf-muted)]">
        <p>{new Date(row.reviewedAt).toLocaleDateString()}</p>
        {row.prUrl && row.prNumber ? (
          <a
            href={row.prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--dpf-accent)] hover:underline"
          >
            PR #{row.prNumber}
          </a>
        ) : null}
      </div>
    ),
    sortAccessor: (row) => row.reviewedAt,
  },
];

export function SeedContributionReviewTable({ rows }: { rows: SeedContributionReviewRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-[var(--dpf-border)]">
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.packId}
        initialSort={{ key: "reviewed", dir: "desc" }}
        pageSize={20}
        empty={(
          <EmptyState
            title="No seed-changing contributions have been reviewed yet"
            description="Seed applicability decisions will appear here before a contribution can become a fleet default."
            size="sm"
            bordered={false}
          />
        )}
      />
    </div>
  );
}
