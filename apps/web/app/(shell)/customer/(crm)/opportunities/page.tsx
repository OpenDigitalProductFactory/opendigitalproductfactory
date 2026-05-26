// apps/web/app/(shell)/customer/opportunities/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";

export default async function OpportunitiesPage() {
  const opportunities = await prisma.opportunity.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTo: { select: { id: true, email: true } },
    },
  });

  // Group by stage for Kanban
  const byStage: Record<string, typeof opportunities> = {};
  for (const stage of OPEN_OPPORTUNITY_STAGES) {
    byStage[stage] = [];
  }
  for (const opp of opportunities) {
    if (!byStage[opp.stage]) byStage[opp.stage] = [];
    byStage[opp.stage]!.push(opp);
  }

  // Pipeline metrics
  const openOpps = opportunities.filter((o) =>
    OPEN_OPPORTUNITY_STAGES.includes(o.stage as (typeof OPEN_OPPORTUNITY_STAGES)[number]),
  );
  const totalPipelineValue = openOpps.reduce(
    (s, o) => s + Number(o.expectedValue ?? 0),
    0,
  );
  const weightedValue = openOpps.reduce(
    (s, o) => s + Number(o.expectedValue ?? 0) * (o.probability / 100),
    0,
  );
  const dormantCount = openOpps.filter((o) => o.isDormant).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Pipeline</h1>
        <div className="flex gap-4 mt-1 text-[10px]">
          <span className="text-[var(--dpf-muted)]">
            {openOpps.length} open opportunit{openOpps.length !== 1 ? "ies" : "y"}
          </span>
          <span className="text-[var(--dpf-accent)]">
            {formatRevenueAmount(totalPipelineValue)} total
          </span>
          <span className="text-[var(--dpf-text)]">
            {formatRevenueAmount(Math.round(weightedValue))} weighted
          </span>
          {dormantCount > 0 && (
            <span className="text-[var(--dpf-text)]">
              {dormantCount} dormant
            </span>
          )}
        </div>
      </div>

      {/* Kanban board — open stages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {OPEN_OPPORTUNITY_STAGES.map((stage) => {
          const meta = getOpportunityStageMeta(stage);
          const toneClasses = CRM_TONE_CLASSES[meta.tone];
          const opps = byStage[stage] ?? [];
          const stageValue = opps.reduce(
            (s, o) => s + Number(o.expectedValue ?? 0),
            0,
          );

          return (
            <div key={stage}>
              <div
                className={[
                  "flex items-center justify-between mb-2 pb-1 border-b-2",
                  toneClasses.border,
                ].join(" ")}
              >
                <span className="text-xs font-semibold text-[var(--dpf-text)]">
                  {meta.label}
                </span>
                <span className="text-[9px] text-[var(--dpf-muted)]">
                  {opps.length} · {formatRevenueAmount(stageValue)}
                </span>
              </div>

              <div className="space-y-2">
                {opps.map((opp) => (
                  <Link
                    key={opp.id}
                    href={`/customer/opportunities/${opp.id}`}
                    className="block p-3 rounded-lg bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-[var(--dpf-text)] leading-tight truncate">
                        {opp.title}
                      </p>
                      {opp.isDormant && (
                        <CustomerStatusBadge label="Dormant" tone="warning" />
                      )}
                    </div>
                    <p className="text-[9px] text-[var(--dpf-muted)] truncate">
                      {opp.account.name}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      {opp.expectedValue && (
                        <span className="text-[10px] font-mono text-[var(--dpf-text)]">
                          {formatRevenueAmount(Number(opp.expectedValue))}
                        </span>
                      )}
                      <span className="text-[9px] text-[var(--dpf-muted)]">
                        {opp.probability}%
                      </span>
                    </div>
                  </Link>
                ))}

                {opps.length === 0 && (
                  <p className="text-[10px] text-[var(--dpf-muted)] text-center py-4">
                    Empty
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Closed deals */}
      {((byStage["closed_won"]?.length ?? 0) > 0 || (byStage["closed_lost"]?.length ?? 0) > 0) && (
        <div>
          <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Closed
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...(byStage["closed_won"] ?? []), ...(byStage["closed_lost"] ?? [])].map(
              (opp) => {
                const meta = getOpportunityStageMeta(opp.stage);
                return (
                  <Link
                    key={opp.id}
                    href={`/customer/opportunities/${opp.id}`}
                    className="p-3 rounded-lg bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs text-[var(--dpf-text)]">{opp.title}</p>
                      <p className="text-[9px] text-[var(--dpf-muted)]">
                        {opp.account.name}
                      </p>
                    </div>
                    <CustomerStatusBadge label={meta.label} tone={meta.tone} />
                  </Link>
                );
              },
            )}
          </div>
        </div>
      )}
    </div>
  );
}
