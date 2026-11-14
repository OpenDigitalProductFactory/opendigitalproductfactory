// Pure capacity-state → routing exclusion (BI-3607DDDA).
//
// Observed ProviderCapacityStatus (rate_limited / reauth_required / billing /
// cooling_down / …) must influence candidate selection. The pipeline already
// soft-excludes endpoints whose *in-memory* runtime circuit is open; this
// module is the same idea for the *persisted* capacity snapshot so a 401-dead
// or API-rate-limited provider is skipped while a healthy local floor remains.
import { accountRuntimeKey } from "./provider-account-candidates";
import { isAccountCapacityState } from "./provider-capacity/scopes";
import { isProviderQuotaState } from "./provider-capacity/types";
import { currentExecutionProof, type ExecutionProof } from "./provider-capacity/execution-proof";

export type CapacitySnapshot = {
  state: string;
  /** Epoch ms when a temporary limit lifts; null/undefined = unknown. */
  retryAtMs?: number | null;
  /** Epoch ms when this snapshot was last observed; null/undefined = unknown. */
  observedAtMs?: number | null;
  /** Most recent completed inference on this exact observation scope. */
  lastSuccessAtMs?: number | null;
  observationSource?: string;
  /** Safe operator-facing recovery facts from the same validated observation. */
  safeSummary?: string | null;
  action?: string | null;
  isHumanActionRequired?: boolean;
  /** Supplied only after the capacity reader revalidates current persisted bindings. */
  executionProof?: ExecutionProof;
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

/**
 * States where the provider itself has said a call will fail: a usage limit
 * with a known future reset, a rejected or missing credential, or a billing or
 * plan block. These never win routing through the all-blocked fallback,
 * because calling them is a guaranteed failure (BI-5A6C4011, WWMD
 * DI-39E7B8DFB7BC). A usage limit with no known reset stays soft so a sole
 * provider is not locked out on a guess.
 */
const HARD_BLOCK_STATES = new Set(["reauth_required", "billing_action_required", "unsupported_plan"]);

/** True when this snapshot blocks routing and the provider has said calls will fail. Pure. */
export function isHardCapacityBlock(snapshot: CapacitySnapshot | null | undefined, nowMs: number): boolean {
  if (!snapshot || !capacityRoutingExclusionReason(snapshot, nowMs)) return false;
  const state = (snapshot.state ?? "").trim().toLowerCase();
  if (HARD_BLOCK_STATES.has(state)) return true;
  return state === "quota_resets_at" && typeof snapshot.retryAtMs === "number" && snapshot.retryAtMs > nowMs;
}

function formatRetry(retryAtMs: number | null | undefined): string {
  if (typeof retryAtMs !== "number" || !Number.isFinite(retryAtMs)) return "";
  return ` until ${new Date(retryAtMs).toISOString()}`;
}

type CapacityCandidate = { providerId: string; providerConnectionId?: string; providerConnectionVersion?: string; modelId?: string };
export type CapacitySoftExcludeInput<T extends CapacityCandidate> = {
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
export function applyCapacitySoftExclusion<T extends CapacityCandidate>(
  input: CapacitySoftExcludeInput<T>,
): CapacitySoftExcludeResult<T> {
  const blocked: Array<{ endpoint: T; reason: string; hard: boolean }> = [];
  const live: T[] = [];

  for (const ep of input.endpoints) {
    const snap = input.capacityByProvider.get(ep.providerId);
    const owned = ep.providerConnectionId ? input.capacityByProvider.get(accountRuntimeKey(ep.providerId, ep.providerConnectionId)) : null;
    const proof = owned?.executionProof;
    // This observation used Responses, not the separately constrained Codex CLI.
    const checked = ep.providerId === "chatgpt" && owned?.state === "available" && proof
      && currentExecutionProof(proof, proof, input.nowMs) && proof.providerId === ep.providerId
      && proof.connectionId === ep.providerConnectionId && proof.modelId === ep.modelId && proof.accountVersion === ep.providerConnectionVersion;
    const inheritedAccountHealth = ep.providerConnectionId && ep.providerConnectionId !== `provider-default-${ep.providerId}` && snap && isAccountCapacityState(snap.state);
    const providerSnapshot = inheritedAccountHealth || checked && snap && isProviderQuotaState(snap.state) ? null : snap;
    const providerReason = capacityRoutingExclusionReason(providerSnapshot, input.nowMs);
    const blocking = providerReason ? providerSnapshot : owned;
    const reason = providerReason ?? capacityRoutingExclusionReason(owned, input.nowMs);
    if (reason) blocked.push({ endpoint: ep, reason, hard: isHardCapacityBlock(blocking, input.nowMs) });
    else live.push(ep);
  }

  if (blocked.length > 0 && live.length > 0) {
    return { eligible: live, excluded: blocked.map(({ endpoint, reason }) => ({ endpoint, reason })) };
  }

  // All blocked (or none). Soft blocks (rate limits, cooling down, degraded)
  // keep degrade-not-lockout so a sole provider install still works. A hard
  // block stays out even when nothing remains: routing then returns its
  // existing no-eligible-endpoint result instead of a guaranteed failure.
  const hard = blocked.filter((b) => b.hard);
  if (hard.length === 0) return { eligible: [...input.endpoints], excluded: [] };
  const hardEndpoints = new Set(hard.map((b) => b.endpoint));
  return {
    eligible: input.endpoints.filter((ep) => !hardEndpoints.has(ep)),
    excluded: hard.map(({ endpoint, reason }) => ({ endpoint, reason })),
  };
}
