import Link from "next/link";
import { Surface } from "@/components/ui/Surface";
import {
  formatMarketingGap,
  formatMarketingLabel,
  getMarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { AgentWorkLauncher } from "@/components/agent/AgentWorkLauncher";
import { ApprovalQueuePanel } from "@/components/customer-marketing/ApprovalQueuePanel";
import { MarketingStrategyOverview } from "@/components/customer-marketing/MarketingStrategyOverview";
import {
  MARKETING_AGENTIC_OPERATIONS_ROUTE,
  buildMarketingAgenticOperationTopics,
} from "@/lib/marketing/agentic-operations";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { buildMarketingOwnerDecision } from "@/lib/marketing/next-decision";
import { getMarketingOperatingSnapshot } from "@/lib/marketing/operating-snapshot";
import {
  buildMarketingDisclosure,
  buildMarketingOwnerQuestion,
} from "@/lib/marketing/disclosure";

export default async function CustomerMarketingPage() {
  // The owner-first decision and the coworker's tool output must report the same
  // state for the same organization, so both read the canonical operating
  // snapshot. The workspace snapshot still drives the strategy/queue panels.
  //
  // Hand the workspace snapshot over so both projections share one point in
  // time and avoid repeating the same organization and strategy reads.
  const snapshot = await getMarketingWorkspaceSnapshot();
  const operating = await getMarketingOperatingSnapshot({ workspace: snapshot });

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Marketing</h1>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">
          Marketing strategy becomes available once an organization has been configured.
        </p>
      </div>
    );
  }

  const suggestions =
    snapshot.latestReview?.suggestedActions.length
      ? snapshot.latestReview.suggestedActions.map((action) => action.description)
      : snapshot.staleAreas.length > 0
        ? snapshot.staleAreas.map(formatMarketingGap)
        : [
            "Ask the Marketing Strategist to confirm the market focus before launching campaigns.",
            "Choose the first audience and channel mix to test.",
          ];
  const marketFocus = snapshot.strategy.geographicScope
    ? `Focused on ${snapshot.strategy.geographicScope}`
    : "Market territory still needs a decision";
  const routeFocus = formatMarketingLabel(snapshot.strategy.routeToMarket);
  const audienceFocus =
    snapshot.strategy.targetSegments[0]?.name ??
    snapshot.strategy.idealCustomerProfiles[0]?.name ??
    "First buyer group not chosen yet";
  const primaryChannels =
    snapshot.strategy.primaryChannels.length > 0
      ? snapshot.strategy.primaryChannels.map(formatMarketingLabel).slice(0, 3).join(", ")
      : "No channel focus chosen yet";
  const proofFocus =
    snapshot.strategy.proofAssets[0]?.label ??
    "No proof asset chosen yet";
  const latestRecommendation = snapshot.latestReview?.recommendation ?? null;
  const recommendedChannels = latestRecommendation?.primaryChannels.length
    ? latestRecommendation.primaryChannels.map(formatMarketingLabel).join(", ")
    : primaryChannels;
  const skippedChannels = latestRecommendation?.skippedChannels.length
    ? latestRecommendation.skippedChannels.map(formatMarketingLabel).join(", ")
    : "No skipped channels recorded";
  const kpiStack = latestRecommendation?.kpis.length
    ? latestRecommendation.kpis.join(", ")
    : "No saved KPI stack yet";
  const launcherTopics = buildMarketingAgenticOperationTopics({
    marketFocus,
    audienceFocus,
    routeFocus,
    primaryChannels,
    recommendedChannels,
    skippedChannels,
    proofFocus,
    kpiStack,
    suggestions,
  });
  const playbook = getPlaybook(snapshot.storefront.category, snapshot.storefront.ctaType);
  const ownerDecision = buildMarketingOwnerDecision(snapshot, playbook, operating ?? undefined);
  const ownerQuestion = buildMarketingOwnerQuestion(snapshot.storefront.category, playbook);
  const disclosure = buildMarketingDisclosure(snapshot);
  const archetypeName = snapshot.storefront.archetypeName ?? "your business";

  return (
    <div className="space-y-6">
      {/* First viewport: ONE owner-first question, then the single recommended
          next step. Strategy / campaign / publish machinery is deferred below. */}
      <section
        data-testid="marketing-owner-decision"
        data-decision-id={ownerDecision.id}
        className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-6"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--dpf-accent)]">
          Start here
        </p>
        <h1
          data-testid="marketing-owner-question"
          className="mt-2 text-xl font-bold text-[var(--dpf-text)]"
        >
          {ownerQuestion}
        </h1>
        <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                Recommended next step
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
                {ownerDecision.headline}
              </p>
              <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
                {ownerDecision.detail}
              </p>
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">
                Moves:{" "}
                <span className="font-medium text-[var(--dpf-text)]">
                  {ownerDecision.metricFocus}
                </span>
              </p>
            </div>
            <Link
              href={ownerDecision.ctaHref}
              className="shrink-0 rounded-full bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {ownerDecision.ctaLabel}
            </Link>
          </div>
        </div>
      </section>

      {/* BI-64F2EA96: the approval loop only closes when the owner can SEE the
          queue from the first viewport. Briefs piled up for a month behind a
          collapsed disclosure while this page led with onboarding copy. When
          anything is waiting — drafts to review, approved posts to publish, or
          briefs that have produced nothing reviewable — say so here, above the
          fold, with a direct path to the action. */}
      {(() => {
        const pendingCount = snapshot.pendingDrafts.length;
        const approvedCount = snapshot.approvedDrafts.length;
        const briefCount = snapshot.workProducts.campaignBriefs.length;
        if (pendingCount === 0 && approvedCount === 0 && briefCount === 0) return null;
        return (
          <Surface as="section" data-testid="marketing-waiting-on-you">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
              {pendingCount > 0 || approvedCount > 0 ? "Waiting on you" : "In progress"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {pendingCount > 0 ? (
                <Link
                  href="/customer/marketing#marketing-approval-queue"
                  className="rounded-full border border-[var(--dpf-accent)] px-3 py-1 font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {pendingCount} {pendingCount === 1 ? "draft" : "drafts"} awaiting your review
                </Link>
              ) : null}
              {approvedCount > 0 ? (
                <Link
                  href="/customer/marketing#marketing-publish-queue"
                  className="rounded-full border border-[var(--dpf-accent)] px-3 py-1 font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
                >
                  {approvedCount} approved {approvedCount === 1 ? "post" : "posts"} ready to publish
                </Link>
              ) : null}
              {pendingCount === 0 && approvedCount === 0 && briefCount > 0 ? (
                <Link
                  href="/customer/marketing/campaigns"
                  className="rounded-full border border-[var(--dpf-border)] px-3 py-1 font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
                >
                  {briefCount} campaign {briefCount === 1 ? "brief" : "briefs"} saved — nothing has
                  reached your review queue yet
                </Link>
              ) : null}
            </div>
          </Surface>
        );
      })()}

      {disclosure.quarantinedCount > 0 ? (
        <section
          data-testid="marketing-quarantine-banner"
          className="rounded-lg border border-[var(--dpf-warning)] bg-[var(--dpf-surface-1)] p-4"
        >
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            {disclosure.quarantinedCount}{" "}
            {disclosure.quarantinedCount === 1 ? "saved item does not" : "saved items do not"} fit{" "}
            {archetypeName}
          </p>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            This looks like imported or test marketing data (for example software-platform copy). It
            is blocked from publishing and does not count as real campaign work. Reset or replace it
            with {archetypeName}-fit campaigns before you launch.
          </p>
        </section>
      ) : null}

      <div id="marketing-launcher" className="scroll-mt-24">
        <AgentWorkLauncher
          agentName="Marketing Strategist"
          primaryActionLabel="Start marketing review"
          topics={launcherTopics}
          routeContext={MARKETING_AGENTIC_OPERATIONS_ROUTE}
        />
      </div>

      {/* Progressive disclosure: strategy, assumptions, and proof stay collapsed
          until the owner asks for them, so the first screen is one decision. */}
      <details
        data-testid="marketing-advanced-strategy"
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      >
        <summary className="cursor-pointer list-none rounded-lg px-6 py-4 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]">
          Strategy, assumptions &amp; proof
          <span className="ml-2 font-normal text-[var(--dpf-muted)]">
            Market, buyer, channels, latest recommendation, and proof
          </span>
        </summary>

        <div className="space-y-6 border-t border-[var(--dpf-border)] p-6">
          <div>
            <h2 className="text-lg font-bold text-[var(--dpf-text)]">
              Work with your Marketing Strategist
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
              Use the AI Coworker to shape the market, choose campaigns, and turn
              rough business context into work that can acquire customers.
            </p>
            <Link
              href="/customer/marketing/strategy"
              className="mt-3 inline-block rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-2 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
            >
              View current assumptions
            </Link>
          </div>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                  Current working focus
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
                  These are starting assumptions for the strategist to challenge,
                  refine, and turn into campaigns.
                </p>
              </div>
              <p className="text-sm font-medium text-[var(--dpf-accent)]">
                {snapshot.latestReview
                  ? formatMarketingLabel(snapshot.latestReview.reviewType)
                  : "First review pending"}
              </p>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Market
                </p>
                <p className="mt-2 text-sm text-[var(--dpf-text)]">{marketFocus}</p>
              </div>
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Buyer
                </p>
                <p className="mt-2 text-sm text-[var(--dpf-text)]">{audienceFocus}</p>
              </div>
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Motion
                </p>
                <p className="mt-2 text-sm text-[var(--dpf-text)]">{routeFocus}</p>
              </div>
              <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                  Channels
                </p>
                <p className="mt-2 text-sm text-[var(--dpf-text)]">{recommendedChannels}</p>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                  Latest strategist recommendation
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
                  Saved recommendations make the current plan visible outside the chat.
                </p>
              </div>
              <p className="text-sm font-medium text-[var(--dpf-accent)]">
                {snapshot.latestReview
                  ? formatMarketingLabel(snapshot.latestReview.reviewType)
                  : "Not saved yet"}
              </p>
            </div>
            {snapshot.latestReview ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                    Do next
                  </p>
                  <p className="mt-2 text-sm text-[var(--dpf-text)]">
                    {snapshot.latestReview.summary}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                    Skip for now
                  </p>
                  <p className="mt-2 text-sm text-[var(--dpf-text)]">{skippedChannels}</p>
                </div>
                <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                    KPI stack
                  </p>
                  <p className="mt-2 text-sm text-[var(--dpf-text)]">{kpiStack}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[var(--dpf-muted)]">
                No saved strategist recommendation yet. Ask the Marketing Strategist
                for a plan and it should persist the recommendation here.
              </p>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                What to clarify with the strategist
              </h2>
              <ul className="mt-4 space-y-2 text-sm text-[var(--dpf-text)]">
                {suggestions.map((suggestion) => (
                  <li key={suggestion} className="rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2">
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">
                Proof before promotion
              </h2>
              <p className="mt-2 text-sm text-[var(--dpf-muted)]">
                Campaigns will perform better when the offer is backed by credible
                evidence. The strategist should help decide what proof to collect,
                write, or publish first.
              </p>
              <p className="mt-4 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]">
                {proofFocus}
              </p>
            </div>
          </section>

          <MarketingStrategyOverview snapshot={snapshot} />
        </div>
      </details>

      {/* Publish/review queues are deferred until there is an archetype-fit
          campaign or real review work, so a fresh workspace is not overloaded
          with empty publish surfaces (BI-8AB9C904). */}
      {disclosure.showPublishReview ? (
        <details
          data-testid="marketing-publish-review"
          open={disclosure.publishReviewOpenByDefault}
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        >
          <summary className="cursor-pointer list-none rounded-lg px-6 py-4 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]">
            Review &amp; publish queue
            <span className="ml-2 font-normal text-[var(--dpf-muted)]">
              Drafts awaiting approval, ready-to-publish, and inbound replies
            </span>
          </summary>
          <div className="border-t border-[var(--dpf-border)] p-6">
            <ApprovalQueuePanel
              pendingDrafts={snapshot.pendingDrafts}
              approvedDrafts={snapshot.approvedDrafts}
              connectedChannels={snapshot.connectedChannels}
              inboundMessages={snapshot.inboundMessages}
              category={snapshot.storefront.category}
            />
          </div>
        </details>
      ) : (
        <section
          data-testid="marketing-publish-deferred"
          className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6"
        >
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Review &amp; publish unlock with your first campaign
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Once you have a {archetypeName}-fit campaign with drafts to approve, the review and
            publish queues appear here. Start a marketing review above to shape that first campaign.
          </p>
        </section>
      )}
    </div>
  );
}
