// apps/web/components/workspace/PlatformReadinessMatrix.tsx
//
// The 6x6 "Six-Cs" domain-readiness matrix. This is a platform-maturity /
// governance view — context, connections, capabilities, cadence, confidence,
// containment across the business domains. It is an OPERATOR concern and lives
// on the platform surface, not on the business day-to-day workspace home
// (see docs/superpowers/specs/2026-06-06-main-portal-workspace-home-redesign-design.md §7).
//
// Each cell now carries a concrete reason and a recommended next action, and
// the grid is backed by an at-a-glance "What needs attention" roll-up so the
// colored matrix actually tells an operator what to do (BI-CE0431B0).
//
// Server component, pure. Status pills compose report-kit StatusBadge so the
// state->color mapping stays in the shared `readiness` intent namespace.

import { StatusBadge } from "@/components/ui/report-kit";
import {
  selectReadinessAttention,
  type BusinessDomainReadiness,
  type ReadinessCell,
  type ReadinessState,
} from "@/lib/workspace-home/command-center";

const STATE_LABEL: Record<ReadinessState, string> = {
  good: "Good",
  attention: "Attention",
  blocked: "Blocked",
  unknown: "Unknown",
};

const ATTENTION_PREVIEW_LIMIT = 8;

function readinessTitle(cell: ReadinessCell): string {
  const base = `${cell.label}: ${STATE_LABEL[cell.state]} - ${cell.reason}`;
  return cell.action ? `${base} - ${cell.action.label}` : base;
}

function StateBadge({ cell, variant = "outline" }: { cell: ReadinessCell; variant?: "outline" | "soft" }) {
  return (
    <StatusBadge
      domain="readiness"
      status={cell.state}
      label={STATE_LABEL[cell.state]}
      variant={variant}
      uppercase={false}
    />
  );
}

/** Wrap a cell badge in a drill-down link (action target, else the dimension href). */
function CellLink({ cell, className = "" }: { cell: ReadinessCell; className?: string }) {
  const title = readinessTitle(cell);
  const href = cell.action?.href ?? cell.href;
  const badge = <StateBadge cell={cell} />;

  if (!href) {
    return (
      <span title={title} aria-label={title} className={className}>
        {badge}
      </span>
    );
  }

  return (
    <a
      href={href}
      title={title}
      aria-label={title}
      className={`inline-flex rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dpf-accent)] ${className}`}
    >
      {badge}
    </a>
  );
}

type Props = {
  readiness: BusinessDomainReadiness[];
};

export function PlatformReadinessMatrix({ readiness }: Props) {
  if (readiness.length === 0) return null;

  const columns = readiness[0]?.cells ?? [];
  const attention = selectReadinessAttention(readiness);
  const attentionPreview = attention.slice(0, ATTENTION_PREVIEW_LIMIT);
  const hiddenAttention = attention.length - attentionPreview.length;

  return (
    <section aria-labelledby="platform-readiness-title" className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Platform readiness</p>
        <h2 id="platform-readiness-title" className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
          Domain readiness
        </h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          How ready each business domain is across six dimensions. Hover or open any cell for the reason and the next
          step; the list below pulls every item that needs action into one place.
        </p>
      </div>

      {/* Legend — what the columns and states mean */}
      <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-sm">
        <summary className="cursor-pointer font-medium text-[var(--dpf-text)]">What this means</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Columns</p>
            <ul className="mt-1 space-y-1 text-[var(--dpf-muted)]">
              {columns.map((cell) => (
                <li key={cell.key}>
                  <span className="font-medium text-[var(--dpf-text)]">{cell.label}</span> — {cell.description}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">States</p>
            <ul className="mt-1 space-y-1 text-[var(--dpf-muted)]">
              <li>
                <span className="font-medium text-[var(--dpf-success)]">Good</span> — healthy, no action needed
              </li>
              <li>
                <span className="font-medium text-[var(--dpf-warning)]">Attention</span> — review and act soon
              </li>
              <li>
                <span className="font-medium text-[var(--dpf-error)]">Blocked</span> — action required now
              </li>
              <li>
                <span className="font-medium text-[var(--dpf-muted)]">Unknown</span> — not tracked yet / no data
              </li>
            </ul>
          </div>
        </div>
      </details>

      {/* Mobile: stacked cards */}
      <div className="grid gap-3 md:hidden">
        {readiness.map((row) => (
          <section key={row.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <a href={row.href} className="text-sm font-semibold text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
              {row.label}
            </a>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {row.cells.map((cell) => (
                <a
                  key={`${row.id}-${cell.key}`}
                  href={cell.action?.href ?? cell.href ?? row.href}
                  className="flex min-h-16 flex-col justify-between gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-xs hover:border-[var(--dpf-accent)]"
                  title={readinessTitle(cell)}
                  aria-label={readinessTitle(cell)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--dpf-muted)]">{cell.label}</span>
                    <StateBadge cell={cell} variant="soft" />
                  </span>
                  <span className="text-[var(--dpf-muted)]">{cell.reason}</span>
                </a>
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
              {columns.map((cell) => (
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
                    <CellLink cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* What needs attention — the actionable roll-up of every non-good cell */}
      <section aria-labelledby="readiness-attention-title" className="space-y-2">
        <h3 id="readiness-attention-title" className="text-sm font-semibold text-[var(--dpf-text)]">
          What needs attention
        </h3>
        {attention.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            All domains are healthy — nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--dpf-border)] rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            {attentionPreview.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <StatusBadge
                  domain="readiness"
                  status={item.state}
                  label={STATE_LABEL[item.state]}
                  variant="soft"
                  uppercase={false}
                />
                <span className="font-medium text-[var(--dpf-text)]">{item.domain}</span>
                <span className="text-[var(--dpf-muted)]">· {item.dimension}</span>
                <span className="text-[var(--dpf-muted)]">— {item.reason}</span>
                <a
                  href={item.href}
                  className="ml-auto whitespace-nowrap font-medium text-[var(--dpf-accent)] hover:underline"
                >
                  {item.actionLabel ?? "Open"} →
                </a>
              </li>
            ))}
          </ul>
        )}
        {hiddenAttention > 0 && (
          <p className="text-xs text-[var(--dpf-muted)]">+{hiddenAttention} more across the matrix</p>
        )}
      </section>
    </section>
  );
}
