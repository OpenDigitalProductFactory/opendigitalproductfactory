export const SUBSCRIPTION_RECHECK_MS = 60 * 60_000;
export const NATIVE_QUOTA_UNKNOWN_RESET_MESSAGE = "The native CLI reported a usage limit; its reset time is unknown.";
export const UNCONFIRMED_USAGE_QUOTA_CODE = "usage_limit_reached";
export const UNCONFIRMED_QUOTA_EXCLUSION = "quota reset unconfirmed";

/** A retry timer is not recovery evidence. Legacy native observations used this fixed safe message. */
export function hasUnconfirmedQuotaReset(observation: {
  state: string; providerCode?: string | null; confidence?: string | null;
  source?: string | null; rawSnippet?: string | null;
}): boolean {
  if (!["rate_limited", "quota_resets_at", "cooling_down"].includes(observation.state)) return false;
  return (observation.providerCode === UNCONFIRMED_USAGE_QUOTA_CODE && observation.confidence === "unknown")
    || (observation.source === "cli" && observation.rawSnippet === NATIVE_QUOTA_UNKNOWN_RESET_MESSAGE);
}
export const subscriptionQuotaJobId = (providerId: string) => `subscription-quota-check-${providerId}`;

/** Keep the provider's estimate distinct from an earlier availability check. */
export function nextSubscriptionQuotaCheck(observedAt: Date | null, lastAttempt: Date | null): Date | null {
  const latest = Math.max(observedAt?.getTime() ?? -Infinity, lastAttempt?.getTime() ?? -Infinity);
  return Number.isFinite(latest) ? new Date(latest + SUBSCRIPTION_RECHECK_MS) : null;
}
