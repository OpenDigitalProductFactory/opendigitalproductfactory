"use client";

// Optimization cockpit — BI-D9B58004 (EP-8DC217EB BET-0a).
//
// Projects the consolidation-bet registry onto live architecture surfaces on
// the /ea/capabilities page (kernel-scored UX-fit decision: overlay/extension
// of the capability map, not a new route). Composes report-kit only.

import { useMemo } from "react";

import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";
import { EmptyState } from "@/components/ui/report-kit/EmptyState";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatCard } from "@/components/ui/report-kit/StatCard";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import type { BetProjection, OptimizationCockpitData } from "@/lib/optimization/load-cockpit-data";

type Props = { data: OptimizationCockpitData };

function betStatusSummary(projection: BetProjection): {
  label: string;
  intentStatus: string;
} {
  const statuses = projection.backlogItems.map((item) => item.status);
  const done = statuses.filter((status) => status === "done").length;
  const total = statuses.length;
  if (total > 0 && done === total) return { label: "done", intentStatus: "done" };
  if (statuses.some((status) => status === "in-progress")) {
    return { label: `in-progress ${done}/${total}`, intentStatus: "in-progress" };
  }
  if (done > 0) return { label: `partial ${done}/${total}`, intentStatus: "in-progress" };
  return { label: "open", intentStatus: "open" };
}

export function OptimizationCockpitSection({ data }: Props) {
  const columns = useMemo<Column<BetProjection>[]>(
    () => [
      {
        key: "bet",
        header: "Bet",
        mono: true,
        cell: (row) => row.bet.betKey,
        sortAccessor: (row) => row.bet.betKey,
      },
      {
        key: "title",
        header: "Consolidation",
        cell: (row) => (
          <div>
            <div className="text-[var(--dpf-text)]">{row.bet.title}</div>
            <div className="mt-0.5 text-[10px] text-[var(--dpf-muted)]">
              {row.bet.moveTypes.join(" · ")} · wave {row.bet.wave} · {row.bet.effort}/
              {row.bet.leverage} · ~{row.bet.leafEstimate} leaf sites
            </div>
          </div>
        ),
      },
      {
        key: "status",
        header: "Delivery",
        cell: (row) => {
          const summary = betStatusSummary(row);
          return <StatusBadge domain="backlogItem" status={summary.intentStatus} label={summary.label} />;
        },
        sortAccessor: (row) => betStatusSummary(row).label,
      },
      {
        key: "blast",
        header: "Blast radius",
        align: "right",
        cell: (row) =>
          row.blastRadius ? (
            <span title={row.blastRadius.unresolvedSelectors.join(", ") || undefined}>
              {row.blastRadius.implementationFileCount} files
              {row.blastRadius.unresolvedSelectors.length > 0
                ? ` (+${row.blastRadius.unresolvedSelectors.length} unresolved)`
                : ""}
            </span>
          ) : (
            <span className="text-[var(--dpf-muted)]">graph offline</span>
          ),
        sortAccessor: (row) => row.blastRadius?.implementationFileCount ?? -1,
      },
      {
        key: "tests",
        header: "Linked tests",
        align: "right",
        cell: (row) =>
          row.blastRadius ? (
            row.blastRadius.relatedTestCount
          ) : (
            <span className="text-[var(--dpf-muted)]">—</span>
          ),
        sortAccessor: (row) => row.blastRadius?.relatedTestCount ?? -1,
      },
      {
        key: "coverage",
        header: "Anchor files indexed",
        align: "right",
        cell: (row) =>
          row.fileCoverage ? (
            `${row.fileCoverage.indexedCount}/${row.fileCoverage.indexedCount + row.fileCoverage.unindexedCount}`
          ) : (
            <span className="text-[var(--dpf-muted)]">—</span>
          ),
        sortAccessor: (row) => row.fileCoverage?.indexedCount ?? -1,
      },
      {
        key: "items",
        header: "Backlog",
        cell: (row) => (
          <div className="space-y-0.5">
            {row.backlogItems.map((item) => (
              <div key={item.itemId} className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-[var(--dpf-muted)]">{item.itemId}</span>
                {item.status ? (
                  <StatusBadge domain="backlogItem" status={item.status} />
                ) : (
                  <StatusBadge intent="neutral" label="unknown" />
                )}
              </div>
            ))}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <section className="mt-6 space-y-4" aria-label="Optimization cockpit">
      <div>
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">
          Optimization cockpit — Vertical Integration Inward
        </h2>
        <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
          The EP-8DC217EB consolidation bets projected onto the live code graph and backlog. Switch
          the map overlay above to “Optimization Impact” to see which capabilities sit in a bet's
          blast path.
        </p>
      </div>

      {!data.freshness.available ? (
        <Notice variant="warn" title="Code graph unavailable">
          {data.freshness.summary} Blast-radius columns are hidden until the graph index is built.
        </Notice>
      ) : data.freshness.warnings.length > 0 ? (
        <Notice variant="info" title="Code graph freshness">
          {data.freshness.warnings.join(" ")}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Consolidation bets" value={data.totals.betCount} />
        <StatCard
          label="Backlog done"
          value={data.totals.backlogDone}
          hint={`${data.totals.backlogInProgress} in progress · ${data.totals.backlogOpen} open`}
          intent={data.totals.backlogDone > 0 ? "success" : "neutral"}
        />
        <StatCard
          label="Blast-radius files"
          value={data.freshness.available ? data.totals.implementationFileCount : "—"}
          hint={data.freshness.available ? "distinct traced implementation files" : "graph offline"}
        />
        <StatCard
          label="Linked tests"
          value={data.freshness.available ? data.totals.relatedTestCount : "—"}
          hint={data.freshness.available ? "tests covering traced surfaces" : "graph offline"}
        />
      </div>

      <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
          Bets ({data.bets.length})
        </summary>
        <div className="mt-3">
          {data.bets.length === 0 ? (
            <EmptyState title="No consolidation bets registered" />
          ) : (
            <DataTable
              columns={columns}
              rows={data.bets}
              getRowKey={(row) => row.bet.betKey}
              dense
              initialSort={{ key: "bet", dir: "asc" }}
            />
          )}
        </div>
      </details>
    </section>
  );
}
