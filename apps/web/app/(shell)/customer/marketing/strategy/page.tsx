import {
  formatMarketingDate,
  formatMarketingLabel,
  getMarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { MarketingStrategyOverview } from "@/components/customer-marketing/MarketingStrategyOverview";

export default async function CustomerMarketingStrategyPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Marketing Strategy</h1>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">
          Strategy details will appear once the organization workspace has been initialized.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Strategy</p>
        <h1 className="mt-2 text-2xl font-bold text-[var(--dpf-text)]">
          Acquisition strategy detail
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
          This is the canonical Phase 1 strategy record for customer acquisition. Editing and
          review-loop authoring arrive in a follow-on phase; for now this page exposes the
          seeded strategy, proof gaps, and latest specialist review.
        </p>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Status</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.status)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Cadence</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.reviewCadence)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Next review</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingDate(snapshot.strategy.nextReviewAt)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Route</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {formatMarketingLabel(snapshot.strategy.routeToMarket)}
            </p>
          </div>
        </div>
      </div>

      <MarketingStrategyOverview snapshot={snapshot} mode="detail" />

      <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">
          Latest review and notes
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
            No structured marketing review has been recorded yet. The strategy shown here is the
            seeded baseline for the first specialist pass.
          </p>
        )}
      </section>
    </div>
  );
}
