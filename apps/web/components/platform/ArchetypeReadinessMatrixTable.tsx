"use client";

import type {
  ArchetypeReadinessEvidenceStatus,
  ArchetypeReadinessTier,
} from "@dpf/storefront-templates";

import {
  DataTable,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";

export type ArchetypeReadinessEvidenceView = {
  id: string;
  title: string;
  kindLabel: string;
  status: ArchetypeReadinessEvidenceStatus;
  statusLabel: string;
};

export type ArchetypeReadinessMatrixRow = {
  categorySlug: string;
  categoryLabel: string;
  leafCount: number;
  highestTier: ArchetypeReadinessTier;
  highestTierLabel: string;
  blockedTierLabels: string[];
  primaryBlocker: string;
  blockerCount: number;
  evidenceRefs: ArchetypeReadinessEvidenceView[];
};

const columns: Column<ArchetypeReadinessMatrixRow>[] = [
  {
    key: "category",
    header: "Archetype category",
    sortAccessor: (row) => row.categoryLabel,
    cell: (row) => (
      <div
        className="min-w-0"
        data-archetype-readiness-category={row.categorySlug}
      >
        <p className="font-medium text-[var(--dpf-text)]">{row.categoryLabel}</p>
        <p className="mt-1 font-mono text-xs text-[var(--dpf-muted)]">
          {row.categorySlug}
        </p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {row.leafCount} leaf archetype{row.leafCount === 1 ? "" : "s"}
        </p>
      </div>
    ),
    width: "22%",
  },
  {
    key: "highest-tier",
    header: "Highest claim",
    sortAccessor: (row) => row.highestTier,
    cell: (row) => (
      <StatusBadge
        domain="archetypeReadinessTier"
        status={row.highestTier}
        label={row.highestTierLabel}
        variant="soft"
        uppercase={false}
      />
    ),
    width: "14%",
  },
  {
    key: "blocked-tiers",
    header: "Blocked higher claims",
    cell: (row) =>
      row.blockedTierLabels.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {row.blockedTierLabels.map((label) => (
            <StatusBadge
              key={label}
              intent="warning"
              label={label}
              variant="soft"
              uppercase={false}
              className="max-w-44"
            />
          ))}
        </div>
      ) : (
        <StatusBadge
          intent="success"
          label="No blocked higher claims"
          variant="soft"
          uppercase={false}
        />
      ),
    width: "24%",
  },
  {
    key: "evidence",
    header: "Evidence refs",
    cell: (row) => (
      <div className="flex min-w-0 flex-wrap gap-1.5">
        {row.evidenceRefs.map((ref) => (
          <span
            key={`${ref.id}-${ref.statusLabel}`}
            title={ref.title}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--dpf-border)] px-2 py-1 text-xs text-[var(--dpf-muted)]"
          >
            <span className="font-mono text-[var(--dpf-text)]">{ref.id}</span>
            <StatusBadge
              domain="archetypeReadinessEvidence"
              status={ref.status}
              label={ref.statusLabel}
              variant="soft"
              uppercase={false}
            />
          </span>
        ))}
      </div>
    ),
    width: "22%",
  },
  {
    key: "primary-blocker",
    header: "Primary blocker",
    cell: (row) => (
      <div className="min-w-0">
        <p className="break-words text-xs leading-5 text-[var(--dpf-text)]">
          {row.primaryBlocker}
        </p>
        {row.blockerCount > 1 ? (
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            +{row.blockerCount - 1} additional blocker
            {row.blockerCount === 2 ? "" : "s"}
          </p>
        ) : null}
      </div>
    ),
  },
];

export function ArchetypeReadinessMatrixTable({
  rows,
}: {
  rows: ArchetypeReadinessMatrixRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.categorySlug}
        initialSort={{ key: "category", dir: "asc" }}
        dense
        className="min-w-full"
      />
    </div>
  );
}
