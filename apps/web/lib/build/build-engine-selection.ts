import { capacityRoutingExclusionReason } from "@/lib/routing/capacity-routing-exclude";
import { dominantExclusion, explainExclusion } from "@/lib/inference/routing-exclusion-buckets";

export const BUILD_ENGINE_IDS = ["claude", "codex", "grok", "opencode", "agentic"] as const;
export type BuildEngineId = (typeof BUILD_ENGINE_IDS)[number];

export type BuildEnginePolicy = {
  mode: "auto" | "pinned";
  pinnedEngine: BuildEngineId | null;
};

export type BuildEngineCandidate = {
  engine: BuildEngineId;
  providerId: string;
  modelId: string | null;
  local: boolean;
  registered: boolean;
  present: boolean;
  providerStatus: string;
  authMethod: string;
  credentialStatus: string | null;
  credentialExpiresAt: number | null;
  providerCapacityState: string | null;
  providerRetryAt: number | null;
  cliRetryAt: number | null;
  providerHealth:
    | "healthy"
    | "unknown"
    | "rate_limited"
    | "needs_reauth"
    | "billing"
    | "cooling_down"
    | "degraded"
    | "unconfigured";
};

export type BuildEngineRejectionCode =
  | "hard-pin-boundary"
  | "residency-local-only"
  | "engine-not-registered"
  | "engine-unhealthy"
  | "provider-disabled"
  | "credential-missing"
  | "credential-expired"
  | "credential-auth-failed"
  | "capacity-retry-window"
  | "provider-unhealthy"
  | "route-contract";

export type BuildEngineRejection = {
  engine: BuildEngineId;
  providerId: string;
  code: BuildEngineRejectionCode;
  reason: string;
};

export type BuildEngineRouteResult = {
  selectedProviderId: string | null;
  selectedModelId: string | null;
  reason: string;
  /** Provider order from routeEndpointV2 after the winner (already ranked). */
  fallbackProviderIds: string[];
  rejectedProviders: Array<{ providerId: string; reason: string }>;
};

export type BuildEngineSelection = {
  status: "selected" | "blocked";
  policy: BuildEnginePolicy;
  selected: BuildEngineCandidate | null;
  reason: string;
  rejected: BuildEngineRejection[];
  fallbackChain: BuildEngineCandidate[];
  fallbackDisabled: boolean;
  action: string | null;
};

const AUTH_FAILED_CREDENTIAL_STATUSES = new Set([
  "auth_failed",
  "error",
  "invalid",
  "revoked",
  "unconfigured",
]);
const UNHEALTHY_PROVIDER_STATES = new Set([
  "rate_limited",
  "needs_reauth",
  "billing",
  "cooling_down",
  "degraded",
  "unconfigured",
]);

function rejectionForCandidate(args: {
  candidate: BuildEngineCandidate;
  policy: BuildEnginePolicy;
  localOnly: boolean;
  nowMs: number;
}): BuildEngineRejection | null {
  const { candidate, policy, localOnly, nowMs } = args;
  const reject = (code: BuildEngineRejectionCode, reason: string): BuildEngineRejection => ({
    engine: candidate.engine,
    providerId: candidate.providerId,
    code,
    reason,
  });

  if (
    policy.mode === "pinned"
    && policy.pinnedEngine !== null
    && candidate.engine !== policy.pinnedEngine
  ) {
    return reject("hard-pin-boundary", `Excluded by the explicit ${policy.pinnedEngine} hard pin.`);
  }
  if (localOnly && !candidate.local) {
    return reject("residency-local-only", "Cloud execution is outside the local-only residency boundary.");
  }
  if (!candidate.registered) {
    return reject("engine-not-registered", "The execution adapter is not registered on this install.");
  }
  if (!candidate.present) {
    return reject("engine-unhealthy", "The build engine is absent or its latest readiness probe failed.");
  }
  if (candidate.providerStatus !== "active") {
    return reject("provider-disabled", "The provider is not enabled for routing.");
  }

  const requiresCredential = candidate.authMethod.toLowerCase() !== "none";
  if (requiresCredential && candidate.credentialStatus === null) {
    return reject("credential-missing", "No credential is connected for this provider.");
  }
  const credentialStatus = candidate.credentialStatus?.toLowerCase() ?? null;
  if (requiresCredential && credentialStatus !== null && credentialStatus === "expired") {
    return reject("credential-expired", "The connected credential is marked expired.");
  }
  if (requiresCredential && credentialStatus !== null && AUTH_FAILED_CREDENTIAL_STATUSES.has(credentialStatus)) {
    return reject(
      "credential-auth-failed",
      `The connected credential is not usable (${credentialStatus}).`,
    );
  }
  if (
    requiresCredential
    && candidate.credentialExpiresAt !== null
    && candidate.credentialExpiresAt <= nowMs
  ) {
    return reject("credential-expired", "The connected credential has expired.");
  }
  if (candidate.cliRetryAt !== null && candidate.cliRetryAt > nowMs) {
    return reject(
      "capacity-retry-window",
      `The CLI pool is in a retry window until ${new Date(candidate.cliRetryAt).toISOString()}.`,
    );
  }
  const capacityReason = capacityRoutingExclusionReason(
    candidate.providerCapacityState
      ? { state: candidate.providerCapacityState, retryAtMs: candidate.providerRetryAt }
      : null,
    nowMs,
  );
  if (capacityReason) {
    return reject("capacity-retry-window", capacityReason);
  }
  if (UNHEALTHY_PROVIDER_STATES.has(candidate.providerHealth)) {
    return reject("provider-unhealthy", `Provider health is ${candidate.providerHealth}.`);
  }
  return null;
}

function uniqueCandidatesInProviderOrder(
  providerIds: readonly string[],
  eligible: readonly BuildEngineCandidate[],
  selected?: BuildEngineCandidate | null,
): BuildEngineCandidate[] {
  const byProvider = new Map<string, BuildEngineCandidate[]>();
  for (const candidate of eligible) {
    const bucket = byProvider.get(candidate.providerId) ?? [];
    bucket.push(candidate);
    byProvider.set(candidate.providerId, bucket);
  }
  const seenEngines = new Set<BuildEngineId>(selected ? [selected.engine] : []);
  const result: BuildEngineCandidate[] = [];
  for (const providerId of providerIds) {
    const candidate = byProvider.get(providerId)?.[0];
    if (!candidate || seenEngines.has(candidate.engine)) continue;
    seenEngines.add(candidate.engine);
    result.push(candidate);
  }
  return result;
}

/**
 * Apply engine-only hard gates, then project the existing router's winner and
 * fallback order. This function never scores or re-ranks candidates.
 */
export function qualifyBuildEngineCandidates(args: {
  policy: BuildEnginePolicy;
  candidates: BuildEngineCandidate[];
  localOnly: boolean;
  nowMs?: number;
}): { eligible: BuildEngineCandidate[]; rejected: BuildEngineRejection[] } {
  const nowMs = args.nowMs ?? Date.now();
  const rejected: BuildEngineRejection[] = [];
  const eligible: BuildEngineCandidate[] = [];
  for (const candidate of args.candidates) {
    const rejection = rejectionForCandidate({
      candidate,
      policy: args.policy,
      localOnly: args.localOnly,
      nowMs,
    });
    if (rejection) rejected.push(rejection);
    else eligible.push(candidate);
  }
  return { eligible, rejected };
}

/**
 * BI-16A1B4A3 — say why no engine was allowed.
 *
 * "Connect, provision, or wait for one allowed Build Studio engine" describes
 * missing or unhealthy infrastructure. On a live install every engine was
 * installed and credentialed, and the real cause was a quality floor no
 * endpoint could clear — so the advice pointed at three actions, none of which
 * could ever change the outcome.
 *
 * routing-exclusion-buckets already turns per-endpoint reasons into one
 * actionable cause for the coworker surfaces; Build Studio simply was not using
 * it. Reuse it here rather than growing a second explanation vocabulary. Falls
 * back to the original string when there are no reasons to bucket (nothing was
 * excluded, so nothing can be named).
 */
function blockedAction(rejected: readonly BuildEngineRejection[]): string {
  const GENERIC = "Connect, provision, or wait for one allowed Build Studio engine, then retry.";
  // Only ROUTE-CONTRACT rejections carry a router reason worth translating. An
  // engine that is absent, unauthenticated or in a capacity retry window really
  // is "connect, provision, or wait" — keep that advice where it is true.
  const routeReasons = rejected
    .filter((entry) => entry.code === "route-contract")
    .map((entry) => entry.reason);
  if (routeReasons.length === 0) return GENERIC;
  const bucketed = dominantExclusion(routeReasons);
  if (!bucketed) return GENERIC;
  const explanation = explainExclusion(bucketed);
  return `${explanation.message} ${explanation.remediation}`;
}

export function selectBuildEngineFromCandidates(args: {
  policy: BuildEnginePolicy;
  candidates: BuildEngineCandidate[];
  route: BuildEngineRouteResult;
  localOnly: boolean;
  nowMs?: number;
}): BuildEngineSelection {
  const { eligible, rejected } = qualifyBuildEngineCandidates(args);

  for (const routeRejection of args.route.rejectedProviders) {
    for (const candidate of eligible.filter((entry) => entry.providerId === routeRejection.providerId)) {
      rejected.push({
        engine: candidate.engine,
        providerId: candidate.providerId,
        code: "route-contract",
        reason: routeRejection.reason,
      });
    }
  }

  if (!args.route.selectedProviderId && args.route.rejectedProviders.length === 0) {
    for (const candidate of eligible) {
      rejected.push({
        engine: candidate.engine,
        providerId: candidate.providerId,
        code: "route-contract",
        reason: args.route.reason,
      });
    }
  }

  const selected = args.route.selectedProviderId
    ? eligible.find((candidate) => candidate.providerId === args.route.selectedProviderId) ?? null
    : null;
  const pinned = args.policy.mode === "pinned";
  if (!selected) {
    const pinnedLabel = args.policy.pinnedEngine ?? "selected";
    return {
      status: "blocked",
      policy: args.policy,
      selected: null,
      reason: pinned
        ? `${pinnedLabel} is not eligible under the current readiness and routing contract.`
        : args.route.reason,
      rejected,
      fallbackChain: [],
      fallbackDisabled: pinned,
      action: pinned
        ? `Restore ${pinnedLabel} readiness or change Advanced execution policy; automatic fallback was disabled by the hard pin.`
        : blockedAction(rejected),
    };
  }

  return {
    status: "selected",
    policy: args.policy,
    selected,
    reason: args.route.reason,
    rejected,
    fallbackChain: pinned
      ? []
      : uniqueCandidatesInProviderOrder(args.route.fallbackProviderIds, eligible, selected),
    fallbackDisabled: pinned,
    action: null,
  };
}

export type RetrySafePreDispatchFailure = "auth" | "rate-limit" | "availability";

/**
 * Short startup failures in these classes occur before a CLI session can
 * mutate phase state. The caller may consume at most one fallback candidate.
 */
export function classifyRetrySafePreDispatchFailure(input: {
  message: string;
  durationMs: number;
  sideEffectsStarted?: boolean;
}): RetrySafePreDispatchFailure | null {
  // Authentication, quota, and connection failures can take a short process
  // startup interval (the live OAuth failure took ~300ms) while still occurring
  // before an agent session or sandbox mutation exists.
  if (input.sideEffectsStarted || input.durationMs > 1_000) return null;
  const message = input.message.toLowerCase();
  if (/auth|oauth|credential|token.*expir|401/.test(message)) return "auth";
  if (/rate.?limit|retry-after|quota|capacity/.test(message)) return "rate-limit";
  if (/unavailable|not found|not installed|enoent|connection refused|cannot connect/.test(message)) {
    return "availability";
  }
  return null;
}
