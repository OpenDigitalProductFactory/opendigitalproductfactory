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
