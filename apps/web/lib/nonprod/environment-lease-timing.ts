// Bounded lease timing shared by preview, local-CI, and host-resource lanes.
export const MAX_LEASE_TTL_MS = 20 * 60_000;
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
export const LOCAL_CI_ACTIVE_LEASE_TTL_MS = 2 * 60_000;
export const HOST_RESOURCE_ACTIVE_LEASE_TTL_MS = 2 * 60_000;

export function admittedLeaseTtlMs(
  environmentKey: string,
  requestedMs: number,
): number {
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
    throw new Error("nonprod_lease_ttl_must_be_positive");
  }
  const boundedRequest = Math.min(MAX_LEASE_TTL_MS, requestedMs);
  if (environmentKey === "local-integration-ci") {
    return Math.min(LOCAL_CI_ACTIVE_LEASE_TTL_MS, boundedRequest);
  }
  if (environmentKey === "host-heavy-resource") {
    return Math.min(HOST_RESOURCE_ACTIVE_LEASE_TTL_MS, boundedRequest);
  }
  return boundedRequest;
}

export function clampLeaseExpiry(
  now: Date,
  requested: Date | undefined,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Date {
  const cap = now.getTime() + MAX_LEASE_TTL_MS;
  const want = (requested ?? new Date(now.getTime() + ttlMs)).getTime();
  return new Date(Math.min(want, cap));
}

export function requestedTtlMs(now: Date, requested: Date): number {
  return Math.max(
    1,
    Math.min(MAX_LEASE_TTL_MS, requested.getTime() - now.getTime()),
  );
}
