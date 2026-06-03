/**
 * Provider health projection (routing-resilience spec §4.3, Slice C).
 *
 * Derives a provider's LIVE REACHABILITY from recent routing telemetry +
 * credential lifecycle + the runtime circuit, instead of presenting the static
 * `ModelProvider.status` ("active") as if it meant the provider works right now.
 * This is the data foundation for the provider-detail health badge and the AI
 * Operations Map markers; the UI consumes the result, this module computes it.
 *
 * Pure by design — all inputs are passed in (no DB, no Date.now) so it is fully
 * unit-testable and free of side effects. A thin loader (follow-up, verified on
 * the live portal) wires it to prisma + the rate-tracker runtime state.
 *
 * Separation of concerns (architect revision):
 *   - `ModelProvider.status`          → admin lifecycle (configured/active/disabled)
 *   - `ModelProfile.modelStatus`      → model quality (active/degraded/retired)
 *   - runtime circuit (rate-tracker)  → "just failed, cooling down"
 *   - THIS module                     → operator-facing live-reachability label,
 *                                       derived from all of the above. It never
 *                                       mutates any of them.
 */

/** Low-cardinality, operator-facing reachability label. */
export type ProviderHealthStatus =
  | "healthy" // recent successful calls; reachable now
  | "rate_limited" // throttled; will self-clear
  | "needs_reauth" // credential expired — requires operator action
  | "billing" // account/billing lapse — requires operator action
  | "cooling_down" // runtime circuit open after a transient/provider error
  | "degraded" // failing but not a clean auth/rate/billing class
  | "unconfigured" // never set up / inactive
  | "unknown"; // no recent signal either way

/** What the operator (or user-facing copy) should do about it. */
export type RemediationKind =
  | "reauth"
  | "wait"
  | "provider_settings"
  | "choose_smaller_request"
  | "none";

export interface ProviderHealth {
  status: ProviderHealthStatus;
  remediationKind: RemediationKind;
  /** Deep link to the action that fixes it (provider detail page). */
  adminActionHref?: string;
  /**
   * Plain-language operator summary. Respects IDENTITY_BLOCK rule #5 — no model
   * IDs, tool names, or internal architecture terms.
   */
  safeSummary: string;
  /** Low-cardinality failure class that drove the status, when applicable. */
  lastFailureClass?: string;
  /** Epoch ms the runtime cooldown lifts, when status is rate_limited/cooling_down. */
  cooldownUntil?: number;
}

/** One recent routing attempt for a provider (newest-first not required). */
export interface RecentOutcome {
  providerErrorCode: string | null;
  fallbackOccurred: boolean;
  createdAt: Date;
  latencyMs: number;
}

export interface ProviderHealthInput {
  providerId: string;
  /** ModelProvider.status — admin lifecycle state. */
  lifecycleStatus: string;
  /** ModelProvider.authMethod — used only to choose the remediation wording. */
  authMethod?: string | null;
  /** Recent RouteOutcome rows for this provider. */
  recentOutcomes: RecentOutcome[];
  /** Runtime circuit state from rate-tracker.getEndpointRuntimeState (optional). */
  runtimeCooldown?: { unavailable: boolean; reason?: string; until?: number };
  /** Epoch ms — injected for deterministic tests (no Date.now in a pure fn). */
  now: number;
  /** Only outcomes newer than this many ms count as "recent". Default 10 min. */
  recentWindowMs?: number;
}

const DEFAULT_RECENT_WINDOW_MS = 10 * 60_000;

/** Map a low-cardinality failure class to the operator remediation. */
export function remediationForFailureClass(
  failureClass: string | null | undefined,
  providerId: string,
): { remediationKind: RemediationKind; adminActionHref?: string } {
  const href = providerDetailHref(providerId);
  switch (failureClass) {
    case "auth":
      return { remediationKind: "reauth", adminActionHref: href };
    case "billing":
      return { remediationKind: "provider_settings", adminActionHref: href };
    case "rate_limit":
    case "overloaded":
    case "transient":
      return { remediationKind: "wait" };
    case "request_too_large":
      return { remediationKind: "choose_smaller_request" };
    default:
      return { remediationKind: "none" };
  }
}

export function providerDetailHref(providerId: string): string {
  return `/platform/ai/providers/${encodeURIComponent(providerId)}`;
}

/**
 * Derive a provider's live-reachability health from telemetry + lifecycle +
 * runtime circuit. Pure; deterministic for a given `now`.
 *
 * Precedence (most actionable first):
 *   1. unconfigured/inactive lifecycle      → unconfigured
 *   2. runtime circuit open (auth/billing)  → needs_reauth / billing
 *   3. disabled lifecycle                   → needs_reauth / billing / degraded
 *   4. runtime circuit open (rate/overload) → rate_limited / cooling_down
 *   5. recent error-dominated outcomes      → mapped class
 *   6. recent successes                     → healthy
 *   7. nothing recent                       → unknown
 */
export function deriveProviderHealth(input: ProviderHealthInput): ProviderHealth {
  const windowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;
  const recent = input.recentOutcomes.filter(
    (o) => input.now - o.createdAt.getTime() <= windowMs,
  );

  // 1. Lifecycle not set up.
  if (
    input.lifecycleStatus === "unconfigured" ||
    input.lifecycleStatus === "inactive"
  ) {
    return {
      status: "unconfigured",
      remediationKind: "provider_settings",
      adminActionHref: providerDetailHref(input.providerId),
      safeSummary: "Not connected. Configure this provider to use it.",
    };
  }

  // 2/4. Runtime circuit open — most current signal of unreachability.
  const cd = input.runtimeCooldown;
  if (cd?.unavailable) {
    const mapped = mapReasonToHealth(cd.reason, input.providerId);
    return {
      ...mapped,
      ...(cd.until !== undefined ? { cooldownUntil: cd.until } : {}),
      lastFailureClass: cd.reason,
    };
  }

  // 3. Lifecycle disabled — fallback.ts disables on auth/billing. Use the most
  // recent hard-failure class to choose the remediation wording.
  if (input.lifecycleStatus === "disabled") {
    const lastClass = mostRecentErrorClass(recent) ?? mostRecentErrorClass(input.recentOutcomes);
    if (lastClass === "billing") {
      return billingHealth(input.providerId);
    }
    // Default a disabled provider to a re-auth ask — that is the dominant cause
    // (an expired OAuth credential) and the action the operator must take.
    return reauthHealth(input.providerId, input.authMethod, lastClass ?? "auth");
  }

  // 5. Recent telemetry is error-dominated.
  if (recent.length > 0) {
    const errors = recent.filter((o) => o.providerErrorCode);
    const successes = recent.filter((o) => !o.providerErrorCode && o.latencyMs > 0);
    if (errors.length > 0 && successes.length === 0) {
      const lastClass = mostRecentErrorClass(recent);
      return mapReasonToHealth(lastClass, input.providerId, recent);
    }
    if (successes.length > 0) {
      return {
        status: "healthy",
        remediationKind: "none",
        safeSummary: "Reachable — recent requests are completing.",
      };
    }
  }

  // 7. No recent signal.
  return {
    status: "unknown",
    remediationKind: "none",
    safeSummary: "No recent activity. Health will update after the next request.",
  };
}

function mapReasonToHealth(
  reason: string | null | undefined,
  providerId: string,
  recent?: RecentOutcome[],
): ProviderHealth {
  switch (reason) {
    case "auth":
      return reauthHealth(providerId, null, "auth");
    case "billing":
      return billingHealth(providerId);
    case "rate_limit":
      return {
        status: "rate_limited",
        remediationKind: "wait",
        safeSummary: "Temporarily rate limited. It will recover on its own shortly.",
        lastFailureClass: "rate_limit",
      };
    case "overloaded":
    case "transient":
    case "provider_error":
      return {
        status: "cooling_down",
        remediationKind: "wait",
        safeSummary: "Recovering from a temporary provider error. Retrying automatically.",
        lastFailureClass: reason ?? undefined,
      };
    default:
      return {
        status: "degraded",
        remediationKind: "provider_settings",
        adminActionHref: providerDetailHref(providerId),
        safeSummary: "Recent requests are failing. Check this provider's settings.",
        ...(recent && mostRecentErrorClass(recent)
          ? { lastFailureClass: mostRecentErrorClass(recent)! }
          : {}),
      };
  }
}

function reauthHealth(
  providerId: string,
  authMethod: string | null | undefined,
  failureClass: string,
): ProviderHealth {
  const isOauth = !authMethod || authMethod.startsWith("oauth");
  return {
    status: "needs_reauth",
    remediationKind: "reauth",
    adminActionHref: providerDetailHref(providerId),
    safeSummary: isOauth
      ? "Needs re-authentication. Reconnect this provider to restore access."
      : "The saved credential was rejected. Update this provider's key to restore access.",
    lastFailureClass: failureClass,
  };
}

function billingHealth(providerId: string): ProviderHealth {
  return {
    status: "billing",
    remediationKind: "provider_settings",
    adminActionHref: providerDetailHref(providerId),
    safeSummary: "Billing or account issue at the provider. Resolve it to restore access.",
    lastFailureClass: "billing",
  };
}

/** Newest error code among the outcomes, or null when none carry an error. */
function mostRecentErrorClass(outcomes: RecentOutcome[]): string | null {
  let newest: RecentOutcome | null = null;
  for (const o of outcomes) {
    if (!o.providerErrorCode) continue;
    if (!newest || o.createdAt.getTime() > newest.createdAt.getTime()) newest = o;
  }
  return newest?.providerErrorCode ?? null;
}
