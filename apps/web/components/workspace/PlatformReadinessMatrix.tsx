// apps/web/components/workspace/PlatformReadinessMatrix.tsx
//
// The 6×6 "Six-Cs" domain-readiness matrix. This is a platform-maturity /
// governance view — context, connections, capabilities, cadence, confidence,
// containment across the business domains. It is an OPERATOR concern and lives
// on the platform surface, not on the business day-to-day workspace home
// (see docs/superpowers/specs/2026-06-06-main-portal-workspace-home-redesign-design.md §7).
//
// Extracted verbatim from BusinessCommandCenter so the worker home no longer
// renders it. Server component, pure.

import type { BusinessDomainReadiness, ReadinessCell, ReadinessState } from "@/lib/workspace/command-center";

const stateClass: Record<ReadinessState, string> = {
  good: "border-[var(--dpf-success)] text-[var(--dpf-success)]",
  attention: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  blocked: "border-[var(--dpf-error)] text-[var(--dpf-error)]",
  unknown: "border-[var(--dpf-border)] text-[var(--dpf-muted)]",
};

const stateLabel: Record<ReadinessState, string> = {
  good: "Good",
  attention: "Attention",
  blocked: "Blocked",
  unknown: "Unknown",
};

function readinessTitle(cell: ReadinessCell) {
  return `${cell.label}: ${stateLabel[cell.state]} - ${cell.description}`;
}

function ReadinessStatusPill({ cell, className = "" }: { cell: ReadinessCell; className?: string }) {
  return (
    <span
      className={`${className} ${stateClass[cell.state]}`}
      title={readinessTitle(cell)}
      aria-label={readinessTitle(cell)}
    >
      {stateLabel[cell.state]}
    </span>
  );
}

type Props = {
  readiness: BusinessDomainReadiness[];
};

export function PlatformReadinessMatrix({ readiness }: Props) {
  if (readiness.length === 0) return null;

  return (
    <section aria-labelledby="platform-readiness-title" className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Platform readiness</p>
        <h2 id="platform-readiness-title" className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
          Domain readiness
        </h2>
      </div>

      {/* Mobile: stacked cards */}
      <div className="grid gap-3 md:hidden">
        {readiness.map((row) => (
          <section key={row.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <a href={row.href} className="text-sm font-semibold text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
              {row.label}
            </a>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {row.cells.map((cell) => (
                <div
                  key={`${row.id}-${cell.key}`}
                  className={`flex min-h-16 flex-col justify-between rounded-md border px-3 py-2 text-xs ${stateClass[cell.state]}`}
                  title={readinessTitle(cell)}
                  aria-label={readinessTitle(cell)}
                >
                  <span className="font-semibold text-[var(--dpf-muted)]">{cell.label}</span>
                  <span className="font-semibold">{stateLabel[cell.state]}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Desktop: matrix table */}
      <div className="hidden overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] md:block">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--dpf-border)]">
              <th className="w-44 px-4 py-3 text-xs font-semibold uppercase text-[var(--dpf-muted)]">Domain</th>
              {readiness[0]?.cells.map((cell) => (
                <th key={cell.key} className="px-3 py-3 text-xs font-semibold uppercase text-[var(--dpf-muted)]">
                  {cell.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {readiness.map((row) => (
              <tr key={row.id} className="border-b border-[var(--dpf-border)] last:border-b-0">
                <th className="px-4 py-3 align-middle font-medium text-[var(--dpf-text)]">
                  <a href={row.href} className="hover:text-[var(--dpf-accent)]">
                    {row.label}
                  </a>
                </th>
                {row.cells.map((cell) => (
                  <td key={`${row.id}-${cell.key}`} className="px-3 py-3 align-middle">
                    <ReadinessStatusPill
                      cell={cell}
                      className="inline-flex min-w-20 justify-center rounded-full border px-2 py-1 text-[11px] font-semibold"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
