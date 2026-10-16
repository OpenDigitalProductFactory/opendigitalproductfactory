export const SUBSCRIPTION_RECHECK_MS = 60 * 60_000;
export const subscriptionQuotaJobId = (providerId: string) => `subscription-quota-check-${providerId}`;

/** Keep the provider's estimate distinct from an earlier availability check. */
export function nextSubscriptionQuotaCheck(observedAt: Date | null, lastAttempt: Date | null): Date | null {
  const latest = Math.max(observedAt?.getTime() ?? -Infinity, lastAttempt?.getTime() ?? -Infinity);
  return Number.isFinite(latest) ? new Date(latest + SUBSCRIPTION_RECHECK_MS) : null;
}
