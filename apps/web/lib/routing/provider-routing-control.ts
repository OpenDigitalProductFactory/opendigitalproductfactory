import { isModelRoutingProvider } from "./provider-eligibility";
import type { ProviderHealth } from "./provider-health";
import type { CliPoolState } from "./cli-pool-status";
import { capacityRoutingExclusionReason, type CapacitySnapshot } from "./capacity-routing-exclude";
import { deriveRoutingEligibility, type RoutingEligibility, type RoutingEligibilityInput } from "./provider-routing-eligibility";
import { resolveRuntimeConnectionStatus } from "./provider-suitability/onboarding-recommendation";

export type RoutingRestriction = { key: string; summary: string; until: string | null };
export type ProviderRoutingControlView = {
  eligibility: RoutingEligibility;
  restrictions: RoutingRestriction[];
  weeklyHint: string | null;
  healthSummary: string;
  healthStatus?: ProviderHealth["status"];
  quotaRecheckAt?: string | null;
};

/** Keep simultaneous vetoes visible; lifting one never claims the others cleared. */
export function projectProviderRoutingControl(input: {
  pw: {
    provider: Omit<RoutingEligibilityInput, "hasCredential"> & {
      providerId: string; defaultConnectionStatus?: string | null;
      operatorPause?: { resumeAt: string | null; pausedAt?: string } | null;
    };
    credential: { hasUsableMaterial?: boolean; tokenExpiresAt?: string | null } | null;
  };
  modelCount: number; now: number; localOnly: boolean;
  health?: ProviderHealth; pool?: CliPoolState;
  hostRestriction?: string | null;
  capacity?: CapacitySnapshot & { safeSummary: string };
  recovery?: { summary: string; nextRunAt: string | null };
  quotaRecovery?: { nextRunAt: string | null };
  quotaRecheckAt?: string | null;
  weeklyHint?: string | null;
}): ProviderRoutingControlView {
  const { provider: p, credential } = input.pw;
  const effectiveStatus = p.defaultConnectionStatus ? resolveRuntimeConnectionStatus(p.status, p.defaultConnectionStatus) : p.status;
  const legacyActivation = p.defaultConnectionStatus === "unconfigured" && ["active", "degraded"].includes(effectiveStatus);
  const restrictions: RoutingRestriction[] = [];
  const add = (key: string, summary: string, until: string | null = null) => restrictions.push({ key, summary, until });
  if (p.operatorPause || p.defaultConnectionStatus === "paused") add("operator", "Paused by an operator.", p.operatorPause?.resumeAt ?? null);
  else if (p.defaultConnectionStatus && !legacyActivation && !["active", "degraded"].includes(p.defaultConnectionStatus)) add("connection", "The connected account is disabled or unavailable.");
  if (input.localOnly && isModelRoutingProvider(p) && !["local", "ollama"].includes(p.providerId)) add("local-only", "Local-only inference is enabled. Cloud traffic is blocked.");
  if (input.pool?.isExhausted) add("quota", "The shared subscription pool has reached a usage limit.", input.pool.resetAt?.toISOString() ?? null);
  if (capacityRoutingExclusionReason(input.capacity, input.now)) add("capacity", input.capacity!.safeSummary, input.capacity?.retryAtMs ? new Date(input.capacity.retryAtMs).toISOString() : null);
  if (input.hostRestriction) add("host-capacity", input.hostRestriction);
  if (input.recovery) add("recovery", input.recovery.summary, input.recovery.nextRunAt);
  if (input.quotaRecovery) add("quota-recovery", "Quota recovery is scheduled.", input.quotaRecovery.nextRunAt);
  // Recent failures are observations. Only a current lifecycle/circuit hold vetoes routing.
  const healthRestricted = (p.status === "disabled" && !["inactive", "disabled"].includes(p.defaultConnectionStatus ?? ""))
    || Boolean(input.health?.cooldownUntil && input.health.cooldownUntil > input.now);
  if (healthRestricted && input.health && ["needs_reauth", "billing", "cooling_down", "rate_limited", "degraded"].includes(input.health.status) && !restrictions.some(r => r.summary === input.health!.safeSummary)) {
    add("health", input.health.safeSummary, input.health.cooldownUntil ? new Date(input.health.cooldownUntil).toISOString() : null);
  }
  const eligibility = deriveRoutingEligibility({
    status: effectiveStatus,
    endpointType: p.endpointType, category: p.category, serviceKind: p.serviceKind,
    authMethod: p.authMethod, hasCredential: credential?.hasUsableMaterial ?? false,
    credentialExpired: Boolean(credential?.tokenExpiresAt && Date.parse(credential.tokenExpiresAt) < input.now),
    discoveredModelCount: input.modelCount, cliPoolExhausted: input.pool?.isExhausted,
  });
  if (!eligibility.eligible && !restrictions.some(r => r.key === "operator" || r.key === "connection") && eligibility.state !== "rate_limited" && (eligibility.state !== "disabled" || !restrictions.length)) add("setup", eligibility.state === "disabled" ? "Provider unavailable. Review its account and health details." : eligibility.reason);
  const effectiveEligibility = p.operatorPause || p.defaultConnectionStatus === "paused"
      ? { ...eligibility, eligible: false, recommendedAction: null, label: "Paused", reason: "Paused by an operator; other restrictions may also apply." }
      : restrictions.length && (eligibility.eligible || eligibility.state === "disabled")
        ? { ...eligibility, eligible: false, recommendedAction: null, state: "disabled" as const, label: "Routing restricted", reason: restrictions[0]!.summary }
      : eligibility;
  return { eligibility: effectiveEligibility, restrictions, weeklyHint: input.weeklyHint ?? null, healthSummary: input.health?.safeSummary ?? "No recent health observation.", healthStatus: input.health?.status, quotaRecheckAt: input.quotaRecheckAt ?? null };
}
