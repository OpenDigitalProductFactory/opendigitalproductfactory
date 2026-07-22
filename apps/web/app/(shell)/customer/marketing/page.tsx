import Link from "next/link";
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

export default async function CustomerMarketingPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

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
  const ownerDecision = buildMarketingOwnerDecision(snapshot, playbook);

  return (
    <div className="space-y-6">
      <section
        data-testid="marketing-owner-decision"
        data-decision-id={ownerDecision.id}
        className="rounded-lg border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-6"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--dpf-accent)]">
              Your next decision
            </p>
            <h2 className="mt-2 text-xl font-bold text-[var(--dpf-text)]">
              {ownerDecision.headline}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--dpf-muted)]">
              {ownerDecision.detail}
            </p>
            <p className="mt-3 text-xs text-[var(--dpf-muted)]">
              Moves: <span className="font-medium text-[var(--dpf-text)]">{ownerDecision.metricFocus}</span>
            </p>
          </div>
          <Link
            href={ownerDecision.ctaHref}
            className="shrink-0 rounded-full bg-[var(--dpf-accent)] px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {ownerDecision.ctaLabel}
          </Link>
        </div>
      </section>

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Customer Marketing
            </p>
            <h1 className="mt-2 text-2xl font-bold text-[var(--dpf-text)]">
              Work with your Marketing Strategist
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
              Use the AI Coworker to shape the market, choose campaigns, and turn
              rough business context into work that can acquire customers.
            </p>
          </div>
          <Link
            href="/customer/marketing/strategy"
            className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-2 text-sm font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            View current assumptions
          </Link>
        </div>

      </div>

      <div id="marketing-launcher" className="scroll-mt-24">
        <AgentWorkLauncher
          agentName="Marketing Strategist"
          primaryActionLabel="Start marketing review"
          topics={launcherTopics}
          routeContext={MARKETING_AGENTIC_OPERATIONS_ROUTE}
        />
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

      <ApprovalQueuePanel
        pendingDrafts={snapshot.pendingDrafts}
        approvedDrafts={snapshot.approvedDrafts}
        connectedChannels={snapshot.connectedChannels}
        inboundMessages={snapshot.inboundMessages}
        category={snapshot.storefront.category}
      />
    </div>
  );
}
