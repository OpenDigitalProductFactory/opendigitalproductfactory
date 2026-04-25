import {
  formatMarketingDate,
  formatMarketingLabel,
  getMarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { MarketingCoworkerActions } from "@/components/customer-marketing/MarketingCoworkerActions";
import { MarketingStrategyOverview } from "@/components/customer-marketing/MarketingStrategyOverview";

export default async function CustomerMarketingStrategyPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

  if (!snapshot) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Marketing Strategy</h1>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">
          Strategy details will appear once the organization workspace has been initialized.
        </p>
      </div>
    );
  }

  const strategyActions = [
    {
      label: "Review",
      title: "Challenge these assumptions",
      description: "Ask the strategist what is ready, what is weak, and what should change before campaigns launch.",
      primary: true,
      prompt:
        "Review these marketing strategy assumptions. Translate them into marketer-friendly language, challenge what looks weak or generic, and ask me one focused question that would improve the acquisition plan.",
    },
    {
      label: "Improve",
      title: "Make this market-ready",
      description: "Turn the current assumptions into positioning, audience, proof, and channel recommendations.",
      prompt:
        "Help me turn the current marketing strategy into a market-ready plan. Recommend positioning, audience, proof, and channels, and call out anything you need me to confirm.",
    },
    {
      label: "Execute",
      title: "Prepare the first campaign",
      description: "Use this strategy as context and draft the first campaign path for review.",
      prompt:
        "Using the current strategy, prepare the first campaign path for review. Include audience, channel, offer, proof needed, and the first action to take.",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Strategy</p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--dpf-text)]">
          Current acquisition assumptions
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
          This is the working context the Marketing Strategist should challenge
          and refine with you before campaigns, outreach, or automation are prepared.
        </p>

        <div className="mt-6">
          <MarketingCoworkerActions actions={strategyActions} />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">State</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.status)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Rhythm</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.reviewCadence)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Next check-in</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingDate(snapshot.strategy.nextReviewAt)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Sales motion</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.routeToMarket)}
            </p>
          </div>
        </div>
      </div>

      <MarketingStrategyOverview snapshot={snapshot} mode="detail" />

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-3 text-base font-semibold text-[var(--dpf-text)]">
          Strategist review
        </h2>
        {snapshot.latestReview ? (
          <div className="space-y-3 text-sm">
            <p className="text-[var(--dpf-text)]">{snapshot.latestReview.summary}</p>
            <p className="text-[var(--dpf-muted)]">
              {formatMarketingLabel(snapshot.latestReview.reviewType)} on{" "}
              {formatMarketingDate(snapshot.latestReview.createdAt)}
            </p>
            {snapshot.latestReview.suggestedActions.length > 0 && (
              <ul className="space-y-2">
                {snapshot.latestReview.suggestedActions.map((action) => (
                  <li
                    key={`${action.description}-${action.priority ?? "normal"}`}
                    className="rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-[var(--dpf-text)]"
                  >
                    {action.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--dpf-muted)]">
            No strategist review has been recorded yet. Start with the review
            action above so the coworker can turn this context into a clearer
            acquisition plan.
          </p>
        )}
      </section>
    </div>
  );
}
