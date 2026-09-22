// Pure capacity-state → routing exclusion (BI-3607DDDA).
//
// Observed ProviderCapacityStatus (rate_limited / reauth_required / billing /
// cooling_down / …) must influence candidate selection. The pipeline already
// soft-excludes endpoints whose *in-memory* runtime circuit is open; this
// module is the same idea for the *persisted* capacity snapshot so a 401-dead
// or API-rate-limited provider is skipped while a healthy local floor remains.

export type CapacitySnapshot = {
  state: string;
  /** Epoch ms when a temporary limit lifts; null/undefined = unknown. */
  retryAtMs?: number | null;
  /** Epoch ms when this snapshot was last observed; null/undefined = unknown. */
  observedAtMs?: number | null;
};

/**
 * A temporary limit (rate_limited / cooling_down) recorded WITHOUT a retryAt
 * stops blocking once its observation is this old. Without a bound, a provider
 * that is never selected never gets a success observation, so a stale snapshot
 * locks it out of routing forever (observed: a July rate limit still excluding
 * the codex engine in September while the local floor timed out every ideate).
 */
export const STALE_TEMPORARY_CAPACITY_MS = 24 * 60 * 60 * 1000;

/** Capacity states that should not win routing while a healthier option exists. */
export const BLOCKING_CAPACITY_STATES = new Set([
  "rate_limited",
  "cooling_down",
  "reauth_required",
  "billing_action_required",
  "unsupported_plan",
  "provider_degraded",
  "request_too_large",
]);

/**
 * Return an exclusion reason string when this capacity snapshot should soft-
 * exclude a provider from the candidate pool; null when routing may still
 * select it. Pure — no DB, no Date.now (pass `nowMs`).
 *
 * Temporary states (rate_limited / cooling_down / quota_resets_at) only block
 * while retryAt is in the future. When retryAt is missing they fail closed
 * (defer to healthier peers) only while the observation is younger than
 * STALE_TEMPORARY_CAPACITY_MS; an unknown observation time stays fail-closed.
 */
export function capacityRoutingExclusionReason(
  snapshot: CapacitySnapshot | null | undefined,
  nowMs: number,
): string | null {
  if (!snapshot) return null;
  const state = (snapshot.state ?? "").trim().toLowerCase();
  if (!state || state === "available" || state === "unknown") return null;

  if (state === "quota_resets_at") {
    const retry = snapshot.retryAtMs;
    if (typeof retry === "number" && retry <= nowMs) return null;
    return `provider capacity quota_resets_at${formatRetry(retry)}`;
  }

  if (!BLOCKING_CAPACITY_STATES.has(state)) return null;

  if (state === "rate_limited" || state === "cooling_down") {
    const retry = snapshot.retryAtMs;
    if (typeof retry === "number") {
      if (retry <= nowMs) return null;
      return `provider capacity ${state}${formatRetry(retry)}`;
    }
    const observed = snapshot.observedAtMs;
    if (typeof observed === "number" && nowMs - observed > STALE_TEMPORARY_CAPACITY_MS) {
      return null;
    }
    return `provider capacity ${state}`;
  }

  // Human-action / structural: always soft-block while a peer is healthy.
  return `provider capacity ${state}`;
}

function formatRetry(retryAtMs: number | null | undefined): string {
  if (typeof retryAtMs !== "number" || !Number.isFinite(retryAtMs)) return "";
  return ` until ${new Date(retryAtMs).toISOString()}`;
}

export type CapacitySoftExcludeInput<T extends { providerId: string }> = {
  endpoints: readonly T[];
  /** providerId → latest capacity snapshot (missing ⇒ available). */
  capacityByProvider: ReadonlyMap<string, CapacitySnapshot>;
  nowMs: number;
};

export type CapacitySoftExcludeResult<T extends { providerId: string }> = {
  eligible: T[];
  /** Endpoints soft-excluded for capacity; only when ≥1 peer remains eligible. */
  excluded: Array<{ endpoint: T; reason: string }>;
};

/**
 * Soft-exclude endpoints whose provider capacity is unhealthy, but only when
 * at least one non-blocked peer remains (same degrade-not-lockout contract as
 * the runtime circuit breaker). Pure.
 */
export function applyCapacitySoftExclusion<T extends { providerId: string }>(
  input: CapacitySoftExcludeInput<T>,
): CapacitySoftExcludeResult<T> {
  const blocked: Array<{ endpoint: T; reason: string }> = [];
  const live: T[] = [];

  for (const ep of input.endpoints) {
    const snap = input.capacityByProvider.get(ep.providerId);
    const reason = capacityRoutingExclusionReason(snap, input.nowMs);
    if (reason) blocked.push({ endpoint: ep, reason });
    else live.push(ep);
  }

  if (blocked.length > 0 && live.length > 0) {
    return { eligible: live, excluded: blocked };
  }

  // All blocked (or none) — keep original list so a sole provider install still works.
  return { eligible: [...input.endpoints], excluded: [] };
}
