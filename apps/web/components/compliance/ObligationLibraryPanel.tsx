import Link from "next/link";

import { StatusBadge } from "@/components/ui/report-kit";
import type {
  ClassifiableRegulation,
  ObligationWithApplicability,
} from "@/lib/compliance-library";

export type ObligationLibraryRow = ObligationWithApplicability<{
  id: string;
  title: string;
  category: string | null;
  applicability: string | null;
  ownerEmployee: { id: string; displayName: string } | null;
  _count: { controls: number };
  regulation: ClassifiableRegulation & {
    id: string;
  };
}>;

type Props = {
  rows: ObligationLibraryRow[];
  contextLabel: string;
  totalCount: number;
};

function sourceAction(row: ObligationLibraryRow) {
  if (!row.regulation.sourceUrl) {
    return <StatusBadge intent="warning" label="Source needed" variant="soft" uppercase={false} />;
  }

  return (
    <a
      href={row.regulation.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-medium text-[var(--dpf-info)] hover:underline"
    >
      Source
    </a>
  );
}

export function ObligationLibraryPanel({ rows, contextLabel, totalCount }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] p-4">
        <p className="text-sm font-medium text-[var(--dpf-text)]">No obligations in this scope for {contextLabel}.</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {totalCount} obligation{totalCount !== 1 ? "s" : ""} remain available across the full reference library.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const hasControls = row._count.controls > 0;
        return (
          <div
            key={row.id}
            className="rounded-lg border border-[var(--dpf-border)] p-3 transition-colors hover:border-[var(--dpf-accent)]"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    domain="complianceApplicability"
                    status={row.regulation.applicability.scope}
                    label={row.regulation.applicability.label}
                    variant="soft"
                    uppercase={false}
                  />
                  <span className="text-sm font-medium text-[var(--dpf-text)]">{row.title}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={`/compliance/regulations/${row.regulation.id}`}
                    className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                  >
                    {row.regulation.shortName}
                  </Link>
                  {row.category && (
                    <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--dpf-muted)]">
                      {row.category}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-[var(--dpf-text)]">{row.regulation.applicability.reason}</p>
                {row.applicability && (
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">{row.applicability}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3 sm:justify-end">
                <StatusBadge
                  intent={hasControls ? "success" : "warning"}
                  label={`${row._count.controls} control${row._count.controls !== 1 ? "s" : ""}`}
                  variant="soft"
                  uppercase={false}
                />
                {row.ownerEmployee && (
                  <span className="text-xs text-[var(--dpf-muted)]">{row.ownerEmployee.displayName}</span>
                )}
                <Link
                  href={`/compliance/obligations/${row.id}`}
                  className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
                >
                  Details
                </Link>
                {sourceAction(row)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
