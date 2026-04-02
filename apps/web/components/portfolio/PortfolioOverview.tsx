// apps/web/components/portfolio/PortfolioOverview.tsx
import Link from "next/link";
import type { PortfolioTreeNode } from "@/lib/portfolio";
import type { PortfolioSummary } from "@/lib/portfolio-data";
import { PORTFOLIO_COLOURS, PORTFOLIO_OWNER_ROLES, computeHealth } from "@/lib/portfolio";
import { LIFECYCLE_STAGE_LABELS } from "@/lib/backlog";
import { PlatformHealthStrip } from "./PlatformHealthStrip";

type Props = {
  roots: PortfolioTreeNode[];
  agentCounts: Record<string, number>;
  budgets: Record<string, string>;
  summary: PortfolioSummary;
};

const STAGE_ORDER = ["plan", "design", "build", "production", "retirement"];
const STAGE_COLOURS: Record<string, string> = {
  plan: "#8888a0",
  design: "#a78bfa",
  build: "#fb923c",
  production: "#4ade80",
  retirement: "#64748b",
};

export function PortfolioOverview({ roots, agentCounts, budgets, summary }: Props) {
  const totalProducts = roots.reduce((sum, r) => sum + r.totalCount, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Portfolio</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {roots.length} portfolios · {totalProducts} digital products
        </p>
      </div>

      {/* Platform health strip (client component — polls Prometheus) */}
      <PlatformHealthStrip />

      {/* Cross-portfolio situation summary */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Situation Summary
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <SummaryCard
            label="Total Products"
            value={summary.totalProducts}
            colour="var(--dpf-text)"
          />
          <SummaryCard
            label="Active"
            value={summary.activeProducts}
            colour="#4ade80"
          />
          <SummaryCard
            label="Draft"
            value={summary.draftProducts}
            colour="#fbbf24"
          />
          <SummaryCard
            label="Open Backlog"
            value={summary.openBacklogItems}
            colour={summary.openBacklogItems > 10 ? "#fbbf24" : "var(--dpf-text)"}
            detail={summary.inProgressBacklogItems > 0 ? `${summary.inProgressBacklogItems} in progress` : undefined}
          />
          <SummaryCard
            label="Open Epics"
            value={summary.openEpics}
            colour="var(--dpf-text)"
          />
          <SummaryCard
            label="AI Agents"
            value={summary.activeAgents}
            colour="#7c8cf8"
            detail={`of ${summary.totalAgents} total`}
          />
        </div>
      </section>

      {/* Product lifecycle distribution */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Lifecycle Distribution
        </h2>
        <LifecycleBar stages={summary.lifecycleStages} total={summary.totalProducts} />
      </section>

      {/* Per-portfolio cards */}
      <section>
        <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Portfolios
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {roots.map((root) => {
            const colour = PORTFOLIO_COLOURS[root.nodeId] ?? "#7c8cf8";
            const ownerRole = PORTFOLIO_OWNER_ROLES[root.nodeId] ?? "--";
            return (
              <Link
                key={root.id}
                href={`/portfolio/${root.nodeId}`}
                className="block p-5 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
                style={{ borderLeftColor: colour }}
              >
                <h3 className="text-base font-semibold text-[var(--dpf-text)] mb-3">
                  {root.name}
                </h3>
                <div className="flex items-center gap-4 flex-wrap">
                  <Stat value={root.totalCount} label="Products" colour="var(--dpf-text)" />
                  <Stat value={computeHealth(root.activeCount, root.totalCount)} label="Health" colour={colour} />
                  <Stat value={agentCounts[root.nodeId] ?? 0} label="Agents" colour={colour} />
                  <Stat value={budgets[root.nodeId] ?? "--"} label="Budget" colour={colour} />
                  <Stat value={ownerRole} label="Owner" colour={colour} small />
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  colour,
  detail,
}: {
  label: string;
  value: number | string;
  colour: string;
  detail?: string;
}) {
  return (
    <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-3">
      <div className="text-lg font-bold" style={{ color: colour }}>
        {value}
      </div>
      <div className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider mt-0.5">
        {label}
      </div>
      {detail && (
        <div className="text-[10px] text-[var(--dpf-muted)] mt-0.5">{detail}</div>
      )}
    </div>
  );
}

function LifecycleBar({ stages, total }: { stages: Record<string, number>; total: number }) {
  if (total === 0) {
    return (
      <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-4 text-center text-xs text-[var(--dpf-muted)]">
        No digital products registered yet.
      </div>
    );
  }

  return (
    <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-4">
      {/* Stacked bar */}
      <div className="flex h-6 rounded overflow-hidden mb-3">
        {STAGE_ORDER.map((stage) => {
          const count = stages[stage] ?? 0;
          if (count === 0) return null;
          const pct = (count / total) * 100;
          return (
            <div
              key={stage}
              className="flex items-center justify-center text-[9px] font-bold text-white"
              style={{
                width: `${pct}%`,
                backgroundColor: STAGE_COLOURS[stage] ?? "#8888a0",
                minWidth: count > 0 ? "24px" : "0",
              }}
              title={`${LIFECYCLE_STAGE_LABELS[stage] ?? stage}: ${count}`}
            >
              {pct >= 8 ? count : ""}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {STAGE_ORDER.map((stage) => {
          const count = stages[stage] ?? 0;
          if (count === 0) return null;
          return (
            <div key={stage} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: STAGE_COLOURS[stage] ?? "#8888a0" }}
              />
              <span className="text-[10px] text-[var(--dpf-muted)]">
                {LIFECYCLE_STAGE_LABELS[stage] ?? stage} ({count})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  colour,
  small,
}: {
  value: number | string;
  label: string;
  colour: string;
  small?: boolean;
}) {
  return (
    <div>
      <p className={small ? "text-sm font-bold" : "text-xl font-bold"} style={{ color: colour }}>
        {value}
      </p>
      <p className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-wider">{label}</p>
    </div>
  );
}
