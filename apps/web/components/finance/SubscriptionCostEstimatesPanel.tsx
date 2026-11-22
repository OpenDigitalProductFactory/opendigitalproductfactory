// What each AI subscription really costs per unit of work (BI-F98BBE4F), what
// its usage is worth at pay-per-token prices, and the savings, from the usage
// of every install that shares the plan (BI-6361A930).
// Server-renderable: the page loads the estimates and its translator and passes them down.

import type { MessageArgs, MessageKey } from "@dpf/i18n";
import { Notice, StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { LOCAL_INSTALL } from "@/lib/finance/subscription-cost-estimator";
import type { SubscriptionPlanEstimate } from "@/lib/finance/subscription-cost-estimator.server";

export type UnpricedSubscription = { providerId: string; name: string };
export type FinanceT = (key: MessageKey<"finance">, args?: MessageArgs) => string;

const CONFIDENCE_INTENT = { high: "success", medium: "warning", low: "neutral" } as const;

function usd(value: number): string {
  return formatMoney(value, "USD", null, { maximumFractionDigits: value < 10 ? 2 : 0 });
}

/** The viewer's number and date conventions, from the page's LocaleContext. */
export type PanelLocale = { formatLocale: string; timeZone: string };
type Formats = { tokens: (n: number) => string; asOf: (iso: string) => string };

function formatsFor(locale: PanelLocale | undefined): Formats {
  const tokens = new Intl.NumberFormat(locale?.formatLocale, { notation: "compact", maximumFractionDigits: 1 });
  const asOf = new Intl.DateTimeFormat(locale?.formatLocale, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
    ...(locale?.timeZone ? { timeZone: locale.timeZone } : {}),
  });
  return { tokens: (n) => tokens.format(n), asOf: (iso) => asOf.format(new Date(iso)) };
}

function installLabel(install: string, t: FinanceT): string {
  return install === LOCAL_INSTALL ? t("subscriptionCosts.installLocal") : t("subscriptionCosts.installPeer", { id: install });
}

/** Token-equivalent value, savings, and where the usage ran. */
function PlanValue({ plan, t, fmt }: { plan: SubscriptionPlanEstimate; t: FinanceT; fmt: Formats }) {
  const v = plan.value;
  const unpriced = v.unpricedProviderIds.join(", ");
  const partial = v.status === "partial";
  const savings = v.monthlySavingsUsd;
  const toMonth = v.monthlyValueUsd != null && v.periodValueUsd > 0 ? v.monthlyValueUsd / v.periodValueUsd : null;
  const showInstalls = plan.installs.length > 1 || (plan.installs.length === 1 && plan.peers.length !== 0);
  const valueLine = v.status === "none"
    ? (unpriced ? t("subscriptionCosts.valueNone", { providers: unpriced }) : null)
    : partial
      ? t("subscriptionCosts.valuePartial", { value: usd(v.monthlyValueUsd ?? 0), providers: unpriced })
      : t("subscriptionCosts.value", { value: usd(v.monthlyValueUsd ?? 0) });
  return (
    <>
      {valueLine ? (
        <p className={`mt-1 text-sm ${v.status === "none" ? "text-[var(--dpf-muted)]" : "text-[var(--dpf-text)]"}`}>{valueLine}</p>
      ) : null}
      {savings != null ? (
        <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
          {savings >= 0
            ? t(partial ? "subscriptionCosts.savingsFloor" : "subscriptionCosts.savings", { amount: usd(savings) })
            : t(partial ? "subscriptionCosts.overspendCeiling" : "subscriptionCosts.overspend", { amount: usd(-savings) })}
        </p>
      ) : null}
      {showInstalls ? (
        <ul className="mt-2 text-xs text-[var(--dpf-muted)]">
          {plan.installs.map((i) => (
            <li key={i.install}>
              {t("subscriptionCosts.installUsage", {
                install: installLabel(i.install, t),
                tokens: fmt.tokens(i.tokens),
                value: usd(toMonth != null ? i.periodValueUsd * toMonth : i.periodValueUsd),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function PeerUsageNotice({ plan, t, fmt }: { plan: SubscriptionPlanEstimate; t: FinanceT; fmt: Formats }) {
  const notices = plan.peers.filter((p) => p.state !== "current");
  if (!notices.length) return null;
  return (
    <div className="mt-2">
      {notices.map((p) => {
        const reason = t(`subscriptionCosts.peerReason.${p.reason ?? "unreachable"}`);
        return (
          <Notice key={p.linkId} variant="warn">
            {p.state === "missing" || !p.lastSuccessAt
              ? t("subscriptionCosts.peerMissing", { reason })
              : t("subscriptionCosts.peerStale", { reason, time: fmt.asOf(p.lastSuccessAt) })}
          </Notice>
        );
      })}
    </div>
  );
}

function PlanEstimate({ plan, t, fmt }: { plan: SubscriptionPlanEstimate; t: FinanceT; fmt: Formats }) {
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
      <PlanValue plan={plan} t={t} fmt={fmt} />
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
          {plan.value.status !== "none" ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">{t("subscriptionCosts.priceBasis")}</p> : null}
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {e.status === "fee-missing" && t("subscriptionCosts.feeMissing")}
          {e.status === "no-usage" && t("subscriptionCosts.noUsage")}
          {e.status === "currency-unsupported" && t("subscriptionCosts.currencyUnsupported", { currency: plan.currency })}
        </p>
      )}
      <PeerUsageNotice plan={plan} t={t} fmt={fmt} />
    </Surface>
  );
}

export function SubscriptionCostEstimatesPanel({
  plans,
  unpriced,
  t,
  locale,
}: {
  plans: SubscriptionPlanEstimate[];
  unpriced: UnpricedSubscription[];
  t: FinanceT;
  locale?: PanelLocale;
}) {
  const fmt = formatsFor(locale);
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
            {plans.map((plan) => <PlanEstimate key={plan.contractId} plan={plan} t={t} fmt={fmt} />)}
          </div>
        ) : null}
      </details>
    </Surface>
  );
}
