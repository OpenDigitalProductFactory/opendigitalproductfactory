// apps/web/app/(shell)/customer/opportunities/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { EmptyPipelineGuidance } from "@/components/customer/EmptyPipelineGuidance";
import { NewOpportunityButton } from "@/components/customer/NewOpportunityButton";
import { PipelineStageInspector } from "@/components/customer/PipelineStageInspector";
import { updateOpportunityStageFromForm } from "@/lib/actions/crm";
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import { getStageAgeDays, isStageStale } from "@/lib/crm/pipeline-inspector";
import { getPipelineInspectorView } from "@/lib/crm/pipeline-inspector-data";
import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";
import { getOrgSettings } from "@/lib/actions/currency";
import {
  PlatformGridSection,
  parseSurfaceDataScope,
  parseSurfaceView,
} from "@/components/workbooks/PlatformGridSection";

type OpportunitiesPageProps = {
  searchParams?: Promise<{ opportunity?: string; view?: string; dataScope?: string }>;
};

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const sp = await searchParams;
  const requestedOpportunityId = sp?.opportunity;
  const view = parseSurfaceView(sp?.view);
  const dataScope = parseSurfaceDataScope(sp?.dataScope);
  const [opportunities, orgSettings, accounts] = await Promise.all([
    prisma.opportunity.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      account: { select: { id: true, accountId: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTo: { select: { id: true, email: true } },
      },
    }),
    getOrgSettings(),
    prisma.customerAccount.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const baseCurrency = orgSettings?.baseCurrency ?? "USD";

  const byStage: Record<string, typeof opportunities> = {};
  for (const stage of OPEN_OPPORTUNITY_STAGES) {
    byStage[stage] = [];
  }
  for (const opp of opportunities) {
    if (!byStage[opp.stage]) byStage[opp.stage] = [];
    byStage[opp.stage]!.push(opp);
  }

  const openOpps = opportunities.filter((o) =>
    OPEN_OPPORTUNITY_STAGES.includes(o.stage as (typeof OPEN_OPPORTUNITY_STAGES)[number]),
  );
  const selectedOpportunityId =
    requestedOpportunityId && opportunities.some((opp) => opp.id === requestedOpportunityId)
      ? requestedOpportunityId
      : openOpps[0]?.id ?? opportunities[0]?.id ?? null;
  const inspector = await getPipelineInspectorView(selectedOpportunityId);
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
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Pipeline</h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
          <span className="text-[var(--dpf-muted)]">
            {openOpps.length} open opportunit{openOpps.length !== 1 ? "ies" : "y"}
          </span>
          <span className="text-[var(--dpf-accent)]">
            {formatRevenueAmount(totalPipelineValue, baseCurrency)} total
          </span>
          <span className="text-[var(--dpf-text)]">
            {formatRevenueAmount(Math.round(weightedValue), baseCurrency)} weighted
          </span>
          {dormantCount > 0 && (
            <span className="text-[var(--dpf-text)]">
              {dormantCount} dormant
            </span>
          )}
        </div>
        </div>
        <NewOpportunityButton accounts={accounts} />
      </div>

      <PlatformGridSection
        entityType="opportunity"
        view={view}
        dataScope={dataScope}
      />

      {!view && (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {OPEN_OPPORTUNITY_STAGES.map((stage) => {
              const meta = getOpportunityStageMeta(stage);
              const toneClasses = CRM_TONE_CLASSES[meta.tone];
              const opps = byStage[stage] ?? [];
              const stageValue = opps.reduce(
                (s, o) => s + Number(o.expectedValue ?? 0),
                0,
              );

              return (
                <section key={stage} className="min-w-0">
                  <div
                    className={[
                      "mb-2 flex items-center justify-between border-b-2 pb-1",
                      toneClasses.border,
                    ].join(" ")}
                  >
                    <span className="text-xs font-semibold text-[var(--dpf-text)]">
                      {meta.label}
                    </span>
                    <span className="text-[9px] text-[var(--dpf-muted)]">
                      {opps.length} / {formatRevenueAmount(stageValue, baseCurrency)}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {opps.map((opp) => {
                      const selected = opp.id === selectedOpportunityId;
                      const stageAgeDays = getStageAgeDays(opp.stageChangedAt);
                      // Deal rotting — ambient visual state, no report needed:
                      // a deal past its stage's inactivity threshold tints red.
                      const rotting = isStageStale({ stage: opp.stage, stageAgeDays, isDormant: opp.isDormant });
                      const nextAt = opp.nextActivityAt ? new Date(opp.nextActivityAt) : null;
                      const nextOverdue = nextAt !== null && nextAt.getTime() < Date.now();
                      return (
                        <Link
                          key={opp.id}
                          href={`/customer/opportunities?opportunity=${opp.id}`}
                          aria-current={selected ? "true" : undefined}
                          className={[
                            "block rounded-lg border bg-[var(--dpf-surface-1)] p-3 transition-colors hover:bg-[var(--dpf-surface-2)]",
                            selected
                              ? "border-[var(--dpf-accent)]"
                              : rotting
                                ? "border-red-500/60"
                                : "border-[var(--dpf-border)]",
                          ].join(" ")}
                        >
                          <div className="mb-1 flex items-start justify-between gap-2">
                            <p className="min-w-0 truncate text-xs font-semibold leading-tight text-[var(--dpf-text)]">
                              {opp.title}
                            </p>
                            {rotting ? (
                              <CustomerStatusBadge label={`Rotting ${stageAgeDays}d`} tone="danger" />
                            ) : opp.isDormant ? (
                              <CustomerStatusBadge label="Dormant" tone="warning" />
                            ) : null}
                          </div>
                          <p className="truncate text-[9px] text-[var(--dpf-muted)]">
                            {opp.account.name}
                          </p>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            {opp.expectedValue && (
                              <span className="truncate text-[10px] font-mono text-[var(--dpf-text)]">
                                {formatRevenueAmount(Number(opp.expectedValue), opp.currency)}
                              </span>
                            )}
                            <span className="shrink-0 text-[9px] text-[var(--dpf-muted)]">
                              {nextAt === null ? (
                                <span className="mr-1 text-amber-400" title="No next step planned">⚠ no next step</span>
                              ) : nextOverdue ? (
                                <span className="mr-1 text-red-400" title="Planned next step is overdue">⚠ step overdue</span>
                              ) : null}
                              {opp.probability}% / {stageAgeDays}d
                            </span>
                          </div>
                        </Link>
                      );
                    })}

                    {opps.length === 0 && (
                      <p className="py-4 text-center text-[10px] text-[var(--dpf-muted)]">
                        Empty
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {((byStage["closed_won"]?.length ?? 0) > 0 || (byStage["closed_lost"]?.length ?? 0) > 0) && (
            <section className="mt-8">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                Closed
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[...(byStage["closed_won"] ?? []), ...(byStage["closed_lost"] ?? [])].map(
                  (opp) => {
                    const meta = getOpportunityStageMeta(opp.stage);
                    return (
                      <Link
                        key={opp.id}
                        href={`/customer/opportunities?opportunity=${opp.id}`}
                        className="flex items-center justify-between rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 transition-colors hover:bg-[var(--dpf-surface-2)]"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs text-[var(--dpf-text)]">{opp.title}</p>
                          <p className="truncate text-[9px] text-[var(--dpf-muted)]">
                            {opp.account.name}
                          </p>
                        </div>
                        <CustomerStatusBadge label={meta.label} tone={meta.tone} />
                      </Link>
                    );
                  },
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          {inspector ? (
            <PipelineStageInspector
              inspector={inspector}
              stageFormAction={updateOpportunityStageFromForm}
            />
          ) : (
            <EmptyPipelineGuidance />
          )}
        </aside>
      </div>
      )}
    </div>
  );
}
