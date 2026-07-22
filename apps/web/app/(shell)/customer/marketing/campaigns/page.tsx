import {
  MarketingDate,
  MarketingEmptyState,
  MarketingLifecycleBadge,
  MarketingMetricGrid,
  MarketingPageHeader,
  MarketingRecordCard,
  MarketingSection,
} from "@/components/customer-marketing/MarketingRoutePrimitives";
import { formatMarketingLabel, getMarketingWorkspaceSnapshot } from "@/lib/marketing";
import { buildMarketingCampaignsView } from "@/lib/marketing/subroutes";
import { ArchetypeFitNotice } from "@/components/customer-marketing/ArchetypeFitNotice";

export default async function CustomerMarketingCampaignsPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

  if (!snapshot) {
    return (
      <MarketingEmptyState
        title="Campaign work is waiting for organization setup"
        description="Campaign briefs and asset tasks become available once the organization workspace has been initialized."
      />
    );
  }

  const view = buildMarketingCampaignsView(snapshot);

  return (
    <div className="space-y-6">
      <MarketingPageHeader
        eyebrow="Customer Marketing"
        title="Campaign work"
        description="Read the campaign briefs, proof assets, asset tasks, and approval posture the strategist has already saved."
        actionHref="/customer/marketing/strategy"
        actionLabel="Review strategy"
      />

      <MarketingMetricGrid metrics={view.metrics} />

      {view.importedTestCount > 0 ? (
        <div
          data-testid="marketing-imported-test-banner"
          className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500"
        >
          <p className="font-semibold">
            {view.importedTestCount} saved{" "}
            {view.importedTestCount === 1 ? "artifact reads" : "artifacts read"} like imported / test
            data
          </p>
          <p className="mt-1 leading-snug">
            These carry software-platform language that doesn&rsquo;t belong in this business&rsquo;s
            marketing. They&rsquo;re flagged below and blocked from publishing — reject or rewrite them
            before they go to a real audience.
          </p>
        </div>
      ) : null}

      <MarketingSection
        title="Campaign briefs"
        description="Briefs define the audience, channel mix, proof, and measurable outcome before individual assets are drafted."
      >
        {view.campaigns.length === 0 ? (
          <MarketingEmptyState
            title="No campaign briefs saved yet"
            description="Ask the Marketing Strategist to turn the current acquisition assumptions into a campaign brief before assets are drafted."
            actionHref="/customer/marketing"
            actionLabel="Open strategist workspace"
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {view.campaigns.map((campaign) => (
              <MarketingRecordCard key={campaign.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                      {campaign.title}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                      {campaign.objective}
                    </p>
                  </div>
                  <MarketingLifecycleBadge status={campaign.status} />
                </div>

                {campaign.archetypeFit.severity !== "ok" ? (
                  <ArchetypeFitNotice assessment={campaign.archetypeFit} className="mt-3" />
                ) : null}

                <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Audience
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">{campaign.audience}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Channels
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">
                      {campaign.channelsLabel}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Asset progress
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">
                      {campaign.taskCount} task{campaign.taskCount === 1 ? "" : "s"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
                      Next work
                    </dt>
                    <dd className="mt-1 text-[var(--dpf-text)]">
                      {campaign.nextWorkLabel}
                    </dd>
                  </div>
                </dl>

                {campaign.kpis.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {campaign.kpis.map((kpi) => (
                      <span
                        key={kpi}
                        className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]"
                      >
                        {kpi}
                      </span>
                    ))}
                  </div>
                ) : null}
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>

      <MarketingSection
        title="Asset tasks"
        description="Asset tasks are the concrete pieces of work that can become approval-gated drafts."
      >
        {view.assetTasks.length === 0 ? (
          <MarketingEmptyState
            title="No asset tasks queued"
            description="Once the strategist saves a task, it will appear here with its channel, due window, and draft posture."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {view.assetTasks.map((task) => (
              <MarketingRecordCard key={task.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
                      {task.title}
                    </h2>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {formatMarketingLabel(task.assetType)} on {task.channelLabel}
                    </p>
                  </div>
                  <MarketingLifecycleBadge status={task.status} />
                </div>
                {task.archetypeFit.severity !== "ok" ? (
                  <ArchetypeFitNotice assessment={task.archetypeFit} className="mt-3" />
                ) : null}
                <p className="mt-3 text-sm text-[var(--dpf-text)]">{task.brief}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[var(--dpf-muted)]">{task.dueWindow}</span>
                  <span className="text-[var(--dpf-muted)]">/</span>
                  <span className="font-medium text-[var(--dpf-text)]">
                    {task.draftStatusLabel}
                  </span>
                </div>
              </MarketingRecordCard>
            ))}
          </div>
        )}
      </MarketingSection>

      <p className="text-xs text-[var(--dpf-muted)]">
        Last strategy review: <MarketingDate value={snapshot.strategy.lastReviewedAt} />
      </p>
    </div>
  );
}
