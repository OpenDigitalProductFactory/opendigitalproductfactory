// What each AI subscription really costs per unit of work (BI-F98BBE4F).
// Server-renderable: the page loads the estimates and its translator and passes them down.

import type { MessageArgs, MessageKey } from "@dpf/i18n";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { formatMoney } from "@/lib/org-locale/org-locale";
import type { SubscriptionPlanEstimate } from "@/lib/finance/subscription-cost-estimator.server";

export type UnpricedSubscription = { providerId: string; name: string };
export type FinanceT = (key: MessageKey<"finance">, args?: MessageArgs) => string;

const CONFIDENCE_INTENT = { high: "success", medium: "warning", low: "neutral" } as const;

function usd(value: number): string {
  return formatMoney(value, "USD", null, { maximumFractionDigits: value < 10 ? 2 : 0 });
}

function PlanEstimate({ plan, t }: { plan: SubscriptionPlanEstimate; t: FinanceT }) {
  const e = plan.estimate;
  const band = e.usdPerMillionTokens;
  const days = String(Math.round(e.observedDays));
  return (
    <Surface as="article" level={2}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{plan.planName ?? plan.contractId}</h3>
        {e.status === "estimated" ? (
          <StatusBadge intent={CONFIDENCE_INTENT[e.confidence]} label={t(`subscriptionCosts.confidence.${e.confidence}`)} variant="soft" />
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        {plan.coveredProviderIds.length
          ? t("subscriptionCosts.covers", { providers: plan.coveredProviderIds.join(", ") })
          : t("subscriptionCosts.coversNone")}
      </p>
      <p className="mt-3 text-sm text-[var(--dpf-text)]">
        {e.monthlyFeeUsd != null
          ? t("subscriptionCosts.fee", { fee: usd(e.monthlyFeeUsd) })
          : t("subscriptionCosts.feeNotRecorded")}
      </p>
      {e.status === "estimated" && band ? (
        <>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {band.low != null && !e.ceilingOnly
              ? t("subscriptionCosts.costRange", { point: usd(band.point), low: usd(band.low), high: usd(band.high) })
              : t("subscriptionCosts.costCeiling", { point: usd(band.point) })}
          </p>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            {e.ceilingOnly
              ? t("subscriptionCosts.basisCeiling", { days })
              : t("subscriptionCosts.basis", { days, limited: String(e.limitedWindows), active: String(e.activeWindows), hours: String(e.windowHours) })}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {e.status === "fee-missing" && t("subscriptionCosts.feeMissing")}
          {e.status === "no-usage" && t("subscriptionCosts.noUsage")}
          {e.status === "currency-unsupported" && t("subscriptionCosts.currencyUnsupported", { currency: plan.currency })}
        </p>
      )}
    </Surface>
  );
}

export function SubscriptionCostEstimatesPanel({
  plans,
  unpriced,
  t,
}: {
  plans: SubscriptionPlanEstimate[];
  unpriced: UnpricedSubscription[];
  t: FinanceT;
}) {
  return (
    // Closed by default: the AI Spend page's arrival view stays within its frozen word budget.
    <Surface as="section">
      <details>
        <summary className="cursor-pointer text-base font-semibold text-[var(--dpf-text)]">
          {t("subscriptionCosts.summary")}
        </summary>
        <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">{t("subscriptionCosts.intro")}</p>
        {unpriced.length > 0 ? (
          <div className="mt-4">
            <Notice variant="warn" title={t("subscriptionCosts.unpricedTitle")}>
              {t("subscriptionCosts.unpriced", { count: unpriced.length, names: unpriced.map((p) => p.name).join(", ") })}
            </Notice>
          </div>
        ) : null}
        {plans.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {plans.map((plan) => <PlanEstimate key={plan.contractId} plan={plan} t={t} />)}
          </div>
        ) : null}
      </details>
    </Surface>
  );
}
