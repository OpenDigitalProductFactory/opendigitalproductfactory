import Link from "next/link";
import {
  formatMarketingDate,
  formatMarketingLabel,
  getMarketingWorkspaceSnapshot,
} from "@/lib/marketing";
import { MarketingStrategyOverview } from "@/components/customer-marketing/MarketingStrategyOverview";

export default async function CustomerMarketingPage() {
  const snapshot = await getMarketingWorkspaceSnapshot();

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
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
        ? snapshot.staleAreas
        : [
            "Review the seeded route-to-market assumptions with the marketing specialist.",
            "Confirm the first channel mix to prioritize for acquisition.",
          ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Customer Marketing
            </p>
            <h1 className="mt-2 text-2xl font-bold text-[var(--dpf-text)]">
              Strategy first, campaigns next
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
              This workspace captures what we know about the business, market, locality,
              channel fit, and proof needed before campaign execution.
            </p>
          </div>
          <Link
            href="/customer/marketing/strategy"
            className="rounded-full bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Open strategy detail
          </Link>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">What we know</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {snapshot.storefront.archetypeName ?? "Unspecified archetype"} serving{" "}
              {snapshot.strategy.geographicScope ?? "an undefined geography"} via{" "}
              {formatMarketingLabel(snapshot.strategy.routeToMarket)}.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">Needs review</p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {snapshot.staleAreas[0] ?? "No immediate stale areas detected."}
            </p>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Next review: {formatMarketingDate(snapshot.strategy.nextReviewAt)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
              Specialist suggests next
            </p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">{suggestions[0]}</p>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              {snapshot.latestReview
                ? `Latest review: ${formatMarketingLabel(snapshot.latestReview.reviewType)}`
                : "No review recorded yet"}
            </p>
          </div>
        </div>
      </div>

      <MarketingStrategyOverview snapshot={snapshot} />

      <section className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">
          Specialist next steps
        </h2>
        <ul className="space-y-2 text-sm text-[var(--dpf-text)]">
          {suggestions.map((suggestion) => (
            <li key={suggestion} className="rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2">
              {suggestion}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
