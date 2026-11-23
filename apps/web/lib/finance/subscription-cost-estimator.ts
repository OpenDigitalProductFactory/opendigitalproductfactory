// Subscription effective-cost estimator v1 (BI-F98BBE4F).
//
// A subscription is not free: its monthly fee buys a capacity that the
// provider meters in reset windows. The effective cost of one unit of work is
// the fee divided by the capacity that is actually usable in a month. Resets
// make that capacity uncertain, so the answer is a band with a confidence,
// never one exact number.
//
// The method, from observations the platform already records:
//   - Usage per reset window (TokenUsage), pooled over the providers a plan
//     covers.
//   - Limit hits per window (RouteOutcome with providerErrorCode rate_limit).
//   - A window in which a limit was hit shows what one window holds. A
//     lockout that spans many windows (a strict provider, a weekly cap) adds
//     limited windows with little or no usage, which pulls that figure down.
//     A generous-reset provider therefore yields more capacity per month and a
//     lower unit cost than a strict one with the same fee and usage.
//
// Pure: no DB, no clock. The loader lives in subscription-cost-estimator.server.ts.

export const DAYS_PER_MONTH = 30.44;
export const ESTIMATE_LOOKBACK_DAYS = 30;
/** The stated session window of the coding subscriptions on record (Claude, ChatGPT/Codex). */
export const DEFAULT_RESET_WINDOW_HOURS = 5;
export const RESET_WINDOW_HOURS: Readonly<Record<string, number>> = {
  "anthropic-sub": 5,
  chatgpt: 5,
  codex: 5,
};

export function resetWindowHoursFor(providerIds: readonly string[]): number {
  const known = providerIds.map((id) => RESET_WINDOW_HOURS[id]).filter((h): h is number => typeof h === "number" && h > 0);
  return known.length ? Math.min(...known) : DEFAULT_RESET_WINDOW_HOURS;
}

const CADENCE_MONTHS: Readonly<Record<string, number>> = { monthly: 1, quarterly: 3, annual: 12 };

/** The recorded subscription payment, normalised to one month. Null when it cannot be read as a fee. */
export function monthlyFeeFromContract(contract: {
  monthlyCommittedAmount: number | null;
  billingCadence: string | null;
}): number | null {
  const amount = contract.monthlyCommittedAmount;
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const months = CADENCE_MONTHS[contract.billingCadence ?? "monthly"];
  if (!months) return null;
  return amount / months;
}

export type WindowObservation = {
  /** Tokens (input + output) recorded in this reset window. */
  tokens: number;
  /** Limit refusals recorded in this window. */
  limitHits: number;
};

export type EstimateConfidence = "high" | "medium" | "low";

export type SubscriptionCostEstimate = {
  status: "estimated" | "fee-missing" | "currency-unsupported" | "no-usage";
  monthlyFeeUsd: number | null;
  windowHours: number;
  observedDays: number;
  activeWindows: number;
  limitedWindows: number;
  /** Usable tokens per month: low = what was actually used; high is null when no limit was ever reached. */
  capacity: { lowTokens: number; pointTokens: number; highTokens: number | null } | null;
  /** USD per million tokens. `high` comes from the low capacity, `low` from the high capacity. */
  usdPerMillionTokens: { low: number | null; point: number; high: number } | null;
  confidence: EstimateConfidence;
  /** No limit was reached, so the point is a ceiling: real capacity may be larger and the cost lower. */
  ceilingOnly: boolean;
};

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function confidenceFor(limitedWindows: number, observedDays: number): EstimateConfidence {
  if (limitedWindows >= 5 && observedDays >= 14) return "high";
  if (limitedWindows >= 1 && observedDays >= 7) return "medium";
  return "low";
}

const perMillion = (feeUsd: number, tokens: number) => (feeUsd / tokens) * 1_000_000;

export function estimateSubscriptionUnitCost(input: {
  monthlyFeeUsd: number | null;
  currency?: string | null;
  windowHours: number;
  /** Days the observations cover (from the first observation to now, at most the lookback). */
  observedDays: number;
  windows: readonly WindowObservation[];
}): SubscriptionCostEstimate {
  const windowHours = input.windowHours > 0 ? input.windowHours : DEFAULT_RESET_WINDOW_HOURS;
  const observedDays = Math.max(1, Math.min(input.observedDays, ESTIMATE_LOOKBACK_DAYS));
  const active = input.windows.filter((w) => w.tokens > 0 || w.limitHits > 0);
  const limited = active.filter((w) => w.limitHits > 0);
  const base = {
    monthlyFeeUsd: input.monthlyFeeUsd,
    windowHours,
    observedDays,
    activeWindows: active.length,
    limitedWindows: limited.length,
    confidence: confidenceFor(limited.length, observedDays),
  };
  const none = { ...base, capacity: null, usdPerMillionTokens: null, ceilingOnly: false };
  if (input.currency && input.currency.toUpperCase() !== "USD") return { ...none, status: "currency-unsupported" };
  if (input.monthlyFeeUsd == null || input.monthlyFeeUsd <= 0) return { ...none, status: "fee-missing" };

  const toMonth = DAYS_PER_MONTH / observedDays;
  const totalTokens = active.reduce((sum, w) => sum + w.tokens, 0);
  if (totalTokens <= 0) return { ...none, status: "no-usage", confidence: "low" };

  const observedMonthly = totalTokens * toMonth;
  const fee = input.monthlyFeeUsd;
  if (limited.length === 0) {
    // Never limited: capacity is at least what was used. The cost is a ceiling.
    return {
      ...base,
      status: "estimated",
      confidence: "low",
      capacity: { lowTokens: observedMonthly, pointTokens: observedMonthly, highTokens: null },
      usdPerMillionTokens: { low: null, point: perMillion(fee, observedMonthly), high: perMillion(fee, observedMonthly) },
      ceilingOnly: true,
    };
  }

  const limitedTokens = limited.map((w) => w.tokens).sort((a, b) => a - b);
  const activeWindowsPerMonth = active.length * toMonth;
  const pointTokens = Math.max(observedMonthly, quantile(limitedTokens, 0.5) * activeWindowsPerMonth);
  const highTokens = Math.max(pointTokens, quantile(limitedTokens, 0.9) * activeWindowsPerMonth);
  return {
    ...base,
    status: "estimated",
    capacity: { lowTokens: observedMonthly, pointTokens, highTokens },
    usdPerMillionTokens: {
      low: perMillion(fee, highTokens),
      point: perMillion(fee, pointTokens),
      high: perMillion(fee, observedMonthly),
    },
    ceilingOnly: false,
  };
}

/** The USD charged for one call at the point estimate; null when no estimate is available. */
export function estimatedCallCostUsd(estimate: SubscriptionCostEstimate | null | undefined, tokens: number): number | null {
  const point = estimate?.status === "estimated" ? estimate.usdPerMillionTokens?.point : undefined;
  if (point == null || !Number.isFinite(point) || tokens <= 0) return null;
  return (tokens * point) / 1_000_000;
}

/** Group window observations from per-window rows (window index → tokens / hits). */
export function mergeWindowObservations(
  usage: ReadonlyArray<{ window: number; tokens: number }>,
  hits: ReadonlyArray<{ window: number; hits: number }>,
): WindowObservation[] {
  const byWindow = new Map<number, WindowObservation>();
  const at = (w: number) => byWindow.get(w) ?? byWindow.set(w, { tokens: 0, limitHits: 0 }).get(w)!;
  for (const row of usage) at(row.window).tokens += row.tokens;
  for (const row of hits) at(row.window).limitHits += row.hits;
  return [...byWindow.values()];
}

// ── Token-equivalent value and usage shared across installs (BI-6361A930) ──
//
// A plan's usage has a dollar value: what the same tokens would have cost at
// the provider's pay-per-token list price (T3 Code, ccusage and LiteLLM spend
// tracking price usage the same way). Savings = that value minus the fee.
//
// A plan belongs to a person, not an install. The owner's production and
// paired Dev installs share each plan, so usage from every install is combined
// and attributed to the install it ran on; the fee comes from this install's
// contract only, so it is counted once. The peer's usage arrives over the
// federation work-sync channel (lib/federation/ai-usage-exchange.ts); when it
// is missing or stale the estimate says so and its confidence drops.

/** Install key for this installation's own usage. Peers are keyed by their installation id. */
export const LOCAL_INSTALL = "local";
/** A peer pull older than this is reported as stale. */
export const PEER_USAGE_STALE_AFTER_MS = 60 * 60_000;

/**
 * A subscription provider recorded at a $0 token price is valued at its
 * pay-per-token sibling's list price. The prices themselves live on the
 * ModelProvider rows; this only says which row prices which plan.
 */
export const LIST_PRICE_SIBLING: Readonly<Record<string, string>> = {
  "anthropic-sub": "anthropic",
  chatgpt: "openai",
};

export type ProviderTokenPrice = { inputPerMToken: number | null; outputPerMToken: number | null };
export type ListPrice = { inputPerMToken: number; outputPerMToken: number; sourceProviderId: string };

function usablePrice(price: ProviderTokenPrice | undefined): price is { inputPerMToken: number; outputPerMToken: number } {
  if (!price) return false;
  const { inputPerMToken: i, outputPerMToken: o } = price;
  return i != null && o != null && Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0 && i + o > 0;
}

/** The provider's own non-zero list price, else its declared sibling's, else null (unpriced). */
export function listPriceFor(providerId: string, prices: ReadonlyMap<string, ProviderTokenPrice>): ListPrice | null {
  for (const source of [providerId, LIST_PRICE_SIBLING[providerId]]) {
    if (!source) continue;
    const price = prices.get(source);
    if (usablePrice(price)) return { inputPerMToken: price.inputPerMToken, outputPerMToken: price.outputPerMToken, sourceProviderId: source };
  }
  return null;
}

/** Usage of one provider on one install in one clock hour (hour = floor(epoch seconds / 3600)). */
export type UsageBucket = {
  install: string;
  providerId: string;
  hour: number;
  inputTokens: number;
  outputTokens: number;
  limitHits: number;
};

/** Pool hourly buckets into reset windows aligned to the epoch, as the local loader always has. */
export function windowsFromHourlyBuckets(
  buckets: ReadonlyArray<Pick<UsageBucket, "hour" | "inputTokens" | "outputTokens" | "limitHits">>,
  windowHours: number,
): WindowObservation[] {
  const hours = windowHours > 0 ? windowHours : DEFAULT_RESET_WINDOW_HOURS;
  return mergeWindowObservations(
    buckets.map((b) => ({ window: Math.floor(b.hour / hours), tokens: b.inputTokens + b.outputTokens })),
    buckets.filter((b) => b.limitHits > 0).map((b) => ({ window: Math.floor(b.hour / hours), hits: b.limitHits })),
  );
}

export type PeerUsageState = "current" | "stale" | "missing";
export type PeerUsageReason = "never-pulled" | "unreachable" | "peer-outdated" | "refused" | "invalid";

/** What this install knows about one paired install's usage. */
export type PeerUsageStatus = {
  linkId: string;
  /** The peer's installation id, or the link id while the peer has never answered. */
  install: string;
  state: PeerUsageState;
  /** Why the last pull failed; null when it landed. */
  reason: PeerUsageReason | null;
  lastSuccessAt: string | null;
};

export type UsageCoverage = "complete" | "peer-stale" | "peer-missing";

export type InstallUsage = {
  install: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** List-price value of this install's priced tokens over the observed period. */
  periodValueUsd: number;
};

export type UsageValuation = {
  /** priced: every token had a list price. partial: some did not, so the value is a floor. none: no usage or no price at all. */
  status: "priced" | "partial" | "none";
  periodValueUsd: number;
  monthlyValueUsd: number | null;
  /** Value minus fee, per month. Null without a fee or a value. A floor when the value is partial. */
  monthlySavingsUsd: number | null;
  unpricedProviderIds: string[];
  /** Provider whose list price valued each covered provider. */
  priceSources: Record<string, string>;
};

export type SubscriptionPlanValuation = {
  estimate: SubscriptionCostEstimate;
  value: UsageValuation;
  installs: InstallUsage[];
  peers: PeerUsageStatus[];
  usageCoverage: UsageCoverage;
};

const LOWER: Record<EstimateConfidence, EstimateConfidence> = { high: "medium", medium: "low", low: "low" };

function coverageOf(peers: readonly PeerUsageStatus[]): UsageCoverage {
  if (peers.some((p) => p.state === "missing")) return "peer-missing";
  if (peers.some((p) => p.state === "stale")) return "peer-stale";
  return "complete";
}

/**
 * Value, savings and effective cost of one plan from the usage of every
 * install that shares it. Pure: the loader supplies buckets, prices and the
 * peer status.
 */
export function estimateSubscriptionPlan(input: {
  monthlyFeeUsd: number | null;
  currency?: string | null;
  coveredProviderIds: readonly string[];
  buckets: readonly UsageBucket[];
  listPrices: ReadonlyMap<string, ProviderTokenPrice>;
  peers: readonly PeerUsageStatus[];
  now: Date;
}): SubscriptionPlanValuation {
  const covered = new Set(input.coveredProviderIds);
  const lookbackFromHour = Math.floor((input.now.getTime() - ESTIMATE_LOOKBACK_DAYS * 86_400_000) / 3_600_000);
  const buckets = input.buckets.filter((b) => covered.has(b.providerId) && b.hour >= lookbackFromHour);

  const windowHours = resetWindowHoursFor(input.coveredProviderIds);
  const firstHour = buckets.length ? Math.min(...buckets.map((b) => b.hour)) : null;
  const observedDays = firstHour == null ? 0 : (input.now.getTime() - firstHour * 3_600_000) / 86_400_000;

  const base = estimateSubscriptionUnitCost({
    monthlyFeeUsd: input.monthlyFeeUsd,
    currency: input.currency,
    windowHours,
    observedDays,
    windows: windowsFromHourlyBuckets(buckets, windowHours),
  });
  const usageCoverage = coverageOf(input.peers);
  const confidence: EstimateConfidence = usageCoverage === "peer-missing" ? "low"
    : usageCoverage === "peer-stale" ? LOWER[base.confidence] : base.confidence;
  const estimate = { ...base, confidence };

  const priceSources: Record<string, string> = {};
  const unpriced = new Set<string>();
  const installs = new Map<string, InstallUsage>();
  let periodValueUsd = 0;
  let pricedTokens = 0;
  for (const b of buckets) {
    const price = listPriceFor(b.providerId, input.listPrices);
    const value = price ? (b.inputTokens * price.inputPerMToken + b.outputTokens * price.outputPerMToken) / 1_000_000 : 0;
    const tokens = b.inputTokens + b.outputTokens;
    if (price) {
      priceSources[b.providerId] = price.sourceProviderId;
      pricedTokens += tokens;
    } else if (tokens > 0) {
      unpriced.add(b.providerId);
    }
    periodValueUsd += value;
    const row = installs.get(b.install) ?? { install: b.install, tokens: 0, inputTokens: 0, outputTokens: 0, periodValueUsd: 0 };
    row.tokens += tokens;
    row.inputTokens += b.inputTokens;
    row.outputTokens += b.outputTokens;
    row.periodValueUsd += value;
    installs.set(b.install, row);
  }

  const status: UsageValuation["status"] = pricedTokens <= 0 ? "none" : unpriced.size > 0 ? "partial" : "priced";
  const toMonth = DAYS_PER_MONTH / Math.max(1, Math.min(observedDays, ESTIMATE_LOOKBACK_DAYS));
  const monthlyValueUsd = status === "none" ? null : periodValueUsd * toMonth;
  const fee = estimate.status === "currency-unsupported" ? null : input.monthlyFeeUsd;
  const ordered = [...installs.values()].sort((a, b) =>
    a.install === LOCAL_INSTALL ? -1 : b.install === LOCAL_INSTALL ? 1 : 0);
  return {
    estimate,
    value: {
      status,
      periodValueUsd,
      monthlyValueUsd,
      monthlySavingsUsd: monthlyValueUsd != null && fee != null && fee > 0 ? monthlyValueUsd - fee : null,
      unpricedProviderIds: [...unpriced].sort(),
      priceSources,
    },
    installs: ordered,
    peers: [...input.peers],
    usageCoverage,
  };
}
