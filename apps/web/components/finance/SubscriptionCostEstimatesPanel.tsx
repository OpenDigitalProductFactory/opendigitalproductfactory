// What each AI subscription really costs per unit of work (BI-F98BBE4F).
// Server-renderable: the page loads the estimates and passes them down.

import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { formatMoney } from "@/lib/org-locale/org-locale";
import type { SubscriptionPlanEstimate } from "@/lib/finance/subscription-cost-estimator.server";

export type UnpricedSubscription = { providerId: string; name: string };

const CONFIDENCE_INTENT = { high: "success", medium: "warning", low: "neutral" } as const;

function usd(value: number): string {
  return formatMoney(value, "USD", null, { maximumFractionDigits: value < 10 ? 2 : 0 });
}

function PlanEstimate({ plan }: { plan: SubscriptionPlanEstimate }) {
  const e = plan.estimate;
  const band = e.usdPerMillionTokens;
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{plan.planName ?? plan.contractId}</h3>
        {e.status === "estimated" ? (
          <StatusBadge intent={CONFIDENCE_INTENT[e.confidence]} label={`${e.confidence} confidence`} variant="soft" />
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">Covers {plan.coveredProviderIds.join(", ") || "no provider"}</p>
      <p className="mt-3 text-sm text-[var(--dpf-text)]">
        Monthly fee: {e.monthlyFeeUsd != null ? usd(e.monthlyFeeUsd) : "not recorded"}
      </p>
      {e.status === "estimated" && band ? (
        <>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            About <strong>{usd(band.point)}</strong> per million tokens
            {band.low != null && !e.ceilingOnly
              ? ` (likely between ${usd(band.low)} and ${usd(band.high)})`
              : " at most"}
          </p>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            {e.ceilingOnly
              ? `Its limits were not reached in ${Math.round(e.observedDays)} days of use, so this is the most it costs; the real figure is probably lower.`
              : `Based on ${Math.round(e.observedDays)} days of use. Limits were reached in ${e.limitedWindows} of ${e.activeWindows} ${e.windowHours}-hour windows.`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {e.status === "fee-missing" && "Record the plan's payment to estimate its cost."}
          {e.status === "no-usage" && "No use recorded in the last 30 days, so there is nothing to divide the fee by yet."}
          {e.status === "currency-unsupported" && `The fee is in ${plan.currency}; only USD fees are estimated so far.`}
        </p>
      )}
    </div>
  );
}

export function SubscriptionCostEstimatesPanel({
  plans,
  unpriced,
}: {
  plans: SubscriptionPlanEstimate[];
  unpriced: UnpricedSubscription[];
}) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-labelledby="subscription-cost-heading">
      <h2 id="subscription-cost-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        What AI subscriptions really cost
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
        A subscription is not free. Its monthly fee is spread over the work it can actually do once its usage limits
        reset. Resets make the exact figure uncertain, so each estimate is a range. Subscription use is charged to
        budgets at this estimate; the daily allowance for paid AI does not count it.
      </p>
      {unpriced.length > 0 ? (
        <div className="mt-4">
          <Notice variant="warn" title="Fee not recorded">
            {unpriced.map((p) => p.name).join(", ")} {unpriced.length === 1 ? "is" : "are"} still counted at $0.
            Record each plan&apos;s payment below to price it.
          </Notice>
        </div>
      ) : null}
      {plans.length > 0 ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {plans.map((plan) => <PlanEstimate key={plan.contractId} plan={plan} />)}
        </div>
      ) : null}
    </section>
  );
}
