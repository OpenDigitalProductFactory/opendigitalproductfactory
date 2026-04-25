import Link from "next/link";
import {
  formatMarketingGap,
  formatMarketingLabel,
  getMarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { AgentWorkLauncher } from "@/components/agent/AgentWorkLauncher";
import { MarketingStrategyOverview } from "@/components/customer-marketing/MarketingStrategyOverview";

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
  const launcherTopics = [
    {
      id: "strategy-review",
      label: "Strategy review",
      description: "Have the strategist translate the current assumptions into plain language and ask the next useful question.",
      prompt:
        "Run a marketing review for this business. Use the current business, storefront, customer, and strategy context. Start by telling me what you think the first marketing decision should be, then ask me one focused question before recommending campaigns.",
      contextSummary: `Market: ${marketFocus}. Buyer: ${audienceFocus}. Motion: ${routeFocus}.`,
      expectedNextStep: "The strategist will ask one focused question before suggesting campaigns.",
    },
    {
      id: "campaign-directions",
      label: "Campaign ideas",
      description: "Turn the current focus into practical campaign options for email, LinkedIn, events, outbound, or content.",
      prompt:
        "Suggest 3 practical campaign directions for this business based on the current strategy. Make them specific to the audience, market, route to market, and likely proof assets. Include the first step I should approve or change.",
      contextSummary: `Channels: ${primaryChannels}. Proof: ${proofFocus}.`,
      expectedNextStep: "The strategist will propose options and ask what you want to shape first.",
    },
    {
      id: "proof-plan",
      label: "Proof of expertise",
      description: "Identify the proof, examples, or authority signals needed before we ask the market to act.",
      prompt:
        "Help me build a proof-of-expertise plan for this business. Identify the testimonials, case studies, outcomes, credentials, examples, or FAQs that would make campaigns more credible, and tell me what to collect first.",
      contextSummary: `Current proof: ${proofFocus}. Buyer: ${audienceFocus}.`,
      expectedNextStep: "The strategist will recommend the first proof asset to collect or draft.",
    },
  ];

  return (
    <div className="space-y-6">
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

      <AgentWorkLauncher
        agentName="Marketing Strategist"
        primaryActionLabel="Start marketing review"
        topics={launcherTopics}
      />

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
            <p className="mt-2 text-sm text-[var(--dpf-text)]">{primaryChannels}</p>
          </div>
        </div>
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
  );
}
