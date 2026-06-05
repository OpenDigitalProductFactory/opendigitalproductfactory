import { prisma } from "@dpf/db";

import {
  MarketingEmptyState,
  MarketingLifecycleBadge,
  MarketingMetricGrid,
  MarketingPageHeader,
  MarketingRecordCard,
  MarketingSection,
} from "@/components/customer-marketing/MarketingRoutePrimitives";
import { getMarketingWorkspaceSnapshot } from "@/lib/marketing";
import {
  buildMarketingFunnelView,
  type MarketingFunnelEvidenceInput,
} from "@/lib/marketing/subroutes";

async function getMarketingFunnelEvidence(): Promise<MarketingFunnelEvidenceInput> {
  const [engagementGroups, opportunities] = await Promise.all([
    prisma.engagement.groupBy({
      by: ["source", "status"],
      _count: true,
    }),
    prisma.opportunity.findMany({
      select: {
        stage: true,
        expectedValue: true,
        engagementId: true,
      },
    }),
  ]);

  const engagementIds = [
    ...new Set(
      opportunities
        .map((opportunity) => opportunity.engagementId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sourceRows =
    engagementIds.length > 0
      ? await prisma.engagement.findMany({
          where: { id: { in: engagementIds } },
          select: { id: true, source: true },
        })
      : [];
  const sourceByEngagementId = new Map(
    sourceRows.map((engagement) => [engagement.id, engagement.source]),
  );

  return {
    engagements: engagementGroups.map((row) => ({
      source: row.source,
      status: row.status,
      count: row._count,
    })),
    opportunities: opportunities.map((opportunity) => ({
      source: opportunity.engagementId
        ? sourceByEngagementId.get(opportunity.engagementId) ?? null
        : null,
      stage: opportunity.stage,
      expectedValue: Number(opportunity.expectedValue ?? 0),
    })),
  };
}

export default async function CustomerMarketingFunnelPage() {
  const [snapshot, evidence] = await Promise.all([
    getMarketingWorkspaceSnapshot(),
    getMarketingFunnelEvidence(),
  ]);

  if (!snapshot) {
    return (
      <MarketingEmptyState
        title="Marketing funnel is waiting for organization setup"
        description="Source and stage evidence becomes available once the organization workspace has been initialized."
      />
    );
  }

  const view = buildMarketingFunnelView(snapshot, evidence);

  return (
    <div className="space-y-6">
      <MarketingPageHeader
        eyebrow="Customer Marketing"
        title="Source and funnel evidence"
        description="Compare acquisition sources, CRM engagements, and opportunity stages without overstating campaign attribution."
        actionHref="/customer/engagements"
        actionLabel="Review signals"
      />

      <MarketingMetricGrid metrics={view.metrics} />

      <MarketingSection
        title="Source evidence"
        description="Rows show the source recorded on CRM engagements and converted opportunities. This is evidence, not a full multi-touch attribution model."
      >
        {view.sourceRows.length === 0 ? (
          <MarketingEmptyState
            title="No source evidence yet"
            description="Route storefront or integration signals into engagements to start building marketing source evidence."
            actionHref="/customer/engagements"
            actionLabel="Open engagements"
          />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {view.sourceRows.map((row) => (
              <MarketingRecordCard key={row.source}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                      {row.source}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {row.evidenceLabel}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--dpf-accent)]">
                    {row.pipelineValueLabel}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Engagements
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{row.engagementCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Opportunities
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{row.opportunityCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Open
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">
                      {row.openOpportunityCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Won
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{row.wonCount}</dd>
                  </div>
                </dl>
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>

      <MarketingSection
        title="Opportunity stages"
        description="Stage evidence shows where sourced opportunities sit in the sales workflow."
      >
        {view.stageRows.length === 0 ? (
          <MarketingEmptyState
            title="No opportunity stage evidence"
            description="Converted engagements will populate this stage view once opportunities exist."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {view.stageRows.map((row) => (
              <MarketingRecordCard key={row.stage}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
                      {row.stageLabel}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {row.count} opportunit{row.count === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--dpf-accent)]">
                    {row.pipelineValueLabel}
                  </span>
                </div>
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>

      <MarketingSection
        title="KPI checkpoints"
        description="Saved strategist KPI checkpoints keep campaign evidence visible while the funnel matures."
      >
        {view.kpiRows.length === 0 ? (
          <MarketingEmptyState
            title="No KPI checkpoints saved"
            description="Ask the strategist to save the first target metric for the campaign or channel under review."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {view.kpiRows.map((row) => (
              <MarketingRecordCard key={row.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
                      {row.metric}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {row.target} / {row.cadence}
                    </p>
                  </div>
                  <MarketingLifecycleBadge status={row.status} />
                </div>
                <p className="mt-3 text-sm text-[var(--dpf-text)]">{row.notes}</p>
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>
    </div>
  );
}
