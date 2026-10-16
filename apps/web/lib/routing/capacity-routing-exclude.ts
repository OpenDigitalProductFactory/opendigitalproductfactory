// Pure capacity-state → routing exclusion (BI-3607DDDA).
//
// Observed ProviderCapacityStatus (rate_limited / reauth_required / billing /
// cooling_down / …) must influence candidate selection. The pipeline already
// soft-excludes endpoints whose *in-memory* runtime circuit is open; this
// module is the same idea for the *persisted* capacity snapshot so a 401-dead
// or API-rate-limited provider is skipped while a healthy local floor remains.
import { accountRuntimeKey } from "./provider-account-candidates";
import { isAccountCapacityState } from "./provider-capacity/scopes";
import { UNCONFIRMED_QUOTA_EXCLUSION } from "./subscription-quota-policy";

export type CapacitySnapshot = {
  state: string;
  /** Provider retry estimate or heuristic check eligibility; never proof of recovery. */
  retryAtMs?: number | null;
  confidence?: "exact" | "header" | "heuristic" | "unknown";
  /** Epoch ms when this snapshot was last observed; null/undefined = unknown. */
  observedAtMs?: number | null;
  lastSuccessAtMs?: number | null;
  /** Safe operator-facing recovery facts from the same validated observation. */
  safeSummary?: string | null;
  action?: string | null;
  isHumanActionRequired?: boolean;
  /** Validated quota exhaustion whose reset is unknown; ordinary work cannot serve as a probe. */
  quotaResetUnconfirmed?: boolean;
};

/** Freeze only safe capacity facts beside each candidate's actual routing result. */
export function capacityEvidenceForEndpoint(endpoint: { providerId: string; providerConnectionId?: string },
  snapshots: ReadonlyMap<string, CapacitySnapshot>): { capacityEvidence?: { provider?: CapacitySnapshot; account?: CapacitySnapshot } } {
  const provider = snapshots.get(endpoint.providerId);
  const account = endpoint.providerConnectionId ? snapshots.get(accountRuntimeKey(endpoint.providerId, endpoint.providerConnectionId)) : undefined;
  if (!provider && !account) return {};
  const project = (value: CapacitySnapshot): CapacitySnapshot => ({ state: value.state,
    retryAtMs: value.retryAtMs ?? null, observedAtMs: value.observedAtMs ?? null,
    ...(value.confidence ? { confidence: value.confidence } : {}),
    ...(value.quotaResetUnconfirmed ? { quotaResetUnconfirmed: true } : {}),
    ...(value.lastSuccessAtMs != null ? { lastSuccessAtMs: value.lastSuccessAtMs } : {}) });
  return { capacityEvidence: { ...(provider ? { provider: project(provider) } : {}), ...(account ? { account: project(account) } : {}) } };
}

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

  if (snapshot.quotaResetUnconfirmed) return `provider capacity ${state}; ${UNCONFIRMED_QUOTA_EXCLUSION}; availability check required`;

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

export type CapacitySoftExcludeInput<T extends { providerId: string; providerConnectionId?: string }> = {
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
export function applyCapacitySoftExclusion<T extends { providerId: string; providerConnectionId?: string }>(
  input: CapacitySoftExcludeInput<T>,
): CapacitySoftExcludeResult<T> {
  const blocked: Array<{ endpoint: T; reason: string }> = [];
  const quotaHeld: Array<{ endpoint: T; reason: string }> = [];
  const live: T[] = [];

  for (const ep of input.endpoints) {
    const snap = input.capacityByProvider.get(ep.providerId);
    const inheritedAccountHealth = ep.providerConnectionId && ep.providerConnectionId !== `provider-default-${ep.providerId}` && snap && isAccountCapacityState(snap.state);
    const providerSnapshot = inheritedAccountHealth ? null : snap;
    const accountSnapshot = ep.providerConnectionId ? input.capacityByProvider.get(accountRuntimeKey(ep.providerId, ep.providerConnectionId)) : null;
    const reason = capacityRoutingExclusionReason(providerSnapshot, input.nowMs)
      ?? capacityRoutingExclusionReason(accountSnapshot, input.nowMs);
    if (reason && (providerSnapshot?.quotaResetUnconfirmed || accountSnapshot?.quotaResetUnconfirmed)) quotaHeld.push({ endpoint: ep, reason });
    else if (reason) blocked.push({ endpoint: ep, reason });
    else live.push(ep);
  }

  if (blocked.length > 0 && live.length > 0) {
    return { eligible: live, excluded: [...quotaHeld, ...blocked] };
  }

  if (quotaHeld.length) {
    const held = new Set(quotaHeld.map(entry => entry.endpoint));
    return { eligible: input.endpoints.filter(endpoint => !held.has(endpoint)), excluded: quotaHeld };
  }

  // All blocked (or none) — keep original list so a sole provider install still works.
  return { eligible: [...input.endpoints], excluded: [] };
}
