import type { CapacitySnapshot } from "@/lib/routing/capacity-routing-exclude";
import { capacityRoutingExclusionReason } from "@/lib/routing/capacity-routing-exclude";
import type { ProviderRoutingControlView } from "@/lib/routing/provider-routing-control";

export type AccountReadiness = {
  state: "working" | "enabled" | "waiting" | "paused" | "blocked" | "unverified";
  label: string;
  summary: string;
  providerResetAt?: string | null;
};

/** Account configuration, current vetoes and observed success remain distinct. */
export function projectAccountReadiness(input: {
  status: string; requiresCredential: boolean; hasCredential: boolean;
  credentialNeedsRenewal: boolean; healthAvailable: boolean;
  capacity?: CapacitySnapshot; sharedCapacity?: CapacitySnapshot;
  control?: ProviderRoutingControlView; sharedRestrictions?: ProviderRoutingControlView["restrictions"];
  now: number; copy: Record<string, string>;
}): AccountReadiness {
  const { copy } = input;
  const result = (state: AccountReadiness["state"], label: string, summary: string): AccountReadiness => ({ state, label, summary });
  const capacity = [input.capacity, input.sharedCapacity].find(snapshot => snapshot && capacityRoutingExclusionReason(snapshot, input.now));
  const hard = capacity && (["reauth_required", "billing_action_required", "unsupported_plan"].includes(capacity.state) || capacity.isHumanActionRequired);
  if (hard) return result("blocked", copy.readinessBlocked, capacity.safeSummary || copy.reviewConnectionSettings);
  if (input.credentialNeedsRenewal || input.control?.eligibility.state === "needs_credentials") {
    return result("blocked", copy.readinessConnection, copy.tokenNeedsRenewal);
  }
  if (input.control?.healthStatus && ["needs_reauth", "billing"].includes(input.control.healthStatus)) {
    return result("blocked", copy.readinessBlocked, input.control.healthSummary);
  }
  if (["disconnected", "disabled"].includes(input.status)) return result("blocked", copy.readinessConnection, copy.reviewConnectionSettings);
  if (input.status === "unconfigured" || (input.requiresCredential && !input.hasCredential)) {
    return result("blocked", copy.needsSetup, copy.reviewConnectionSettings);
  }
  const restrictions = [...(input.control?.restrictions ?? []), ...(input.sharedRestrictions ?? [])];
  if (input.status === "paused" || restrictions.some(r => r.key === "operator")) {
    return result("paused", copy.paused, copy.readinessPausedSummary);
  }
  if (capacity || restrictions.some(r => ["capacity", "quota", "quota-recovery", "host-capacity", "recovery", "health"].includes(r.key))) {
    return { ...result("waiting", copy.readinessWaiting, capacity && ["rate_limited", "quota_resets_at"].includes(capacity.state)
      ? copy.readinessWaitingSummary : capacity?.safeSummary || restrictions.find(r => ["capacity", "quota", "host-capacity", "health", "recovery"].includes(r.key))?.summary || copy.readinessWaitingSummary),
      providerResetAt: capacity?.retryAtMs ? new Date(capacity.retryAtMs).toISOString() : null };
  }
  if (input.control && !input.control.eligibility.eligible) {
    return result(input.control.eligibility.state === "no_models" ? "blocked" : "paused", copy.readinessRestricted, input.control.eligibility.reason);
  }
  if (!input.healthAvailable) return result("unverified", copy.readinessUnverified, copy.routingCheckUnavailable);
  if (input.capacity?.state === "available" && input.capacity.lastSuccessAtMs
      && input.now - input.capacity.lastSuccessAtMs >= 0 && input.now - input.capacity.lastSuccessAtMs < 60 * 60_000) {
    return result("working", copy.readinessWorking, copy.readinessWorkingSummary);
  }
  return result("enabled", copy.readinessEnabled, copy.readinessEnabledSummary);
}
