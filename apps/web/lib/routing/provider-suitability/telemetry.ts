import type { ProviderSuitabilityPolicy } from "./types";

export const PROVIDER_SUITABILITY_ROLLOUT_STAGES = [
  "compiler-shadow",
  "admin-preview",
  "onboarding-recommendation",
  "selected-vertical-bindings",
  "restricted-openrouter",
  "evidence-enforcement",
  "continuous-tuning",
] as const;

export type ProviderSuitabilityRolloutStage = (typeof PROVIDER_SUITABILITY_ROLLOUT_STAGES)[number];

export type ProviderSuitabilityRollout = {
  stage: ProviderSuitabilityRolloutStage;
  compilerShadow: boolean;
  adminPreview: boolean;
  onboardingRecommendation: boolean;
  selectedVerticalBindings: boolean;
  restrictedOpenRouter: boolean;
  evidenceEnforcement: boolean;
  continuousTuning: boolean;
};

export function resolveProviderSuitabilityRollout(
  requested: string | null | undefined,
): ProviderSuitabilityRollout {
  const stage = PROVIDER_SUITABILITY_ROLLOUT_STAGES.includes(requested as ProviderSuitabilityRolloutStage)
    ? requested as ProviderSuitabilityRolloutStage
    : "evidence-enforcement";
  const enabled = (candidate: ProviderSuitabilityRolloutStage) =>
    PROVIDER_SUITABILITY_ROLLOUT_STAGES.indexOf(stage) >= PROVIDER_SUITABILITY_ROLLOUT_STAGES.indexOf(candidate);
  return {
    stage,
    compilerShadow: enabled("compiler-shadow"),
    adminPreview: enabled("admin-preview"),
    onboardingRecommendation: enabled("onboarding-recommendation"),
    selectedVerticalBindings: enabled("selected-vertical-bindings"),
    restrictedOpenRouter: enabled("restricted-openrouter"),
    evidenceEnforcement: enabled("evidence-enforcement"),
    continuousTuning: enabled("continuous-tuning"),
  };
}

export type ObservedProviderPosture = Partial<{
  executionChannel: string;
  accountClass: string;
  planLimit: string;
  endpoint: string;
  credentialKind: string;
}>;

export type ProviderSuitabilityDriftKind =
  | "catalog-stale"
  | "attestation-stale"
  | "contract-expiring"
  | "contract-expired"
  | "regional-entitlement-expiring"
  | "regional-entitlement-expired"
  | "evidence-expired"
  | "evidence-rejected"
  | "repeated-route-failure"
  | "execution-channel-mismatch"
  | "account-class-mismatch"
  | "plan-limit-mismatch"
  | "endpoint-mismatch"
  | "credential-mismatch";

export type ProviderSuitabilityDriftSignal = {
  providerConnectionId: string;
  providerId: string;
  providerName: string;
  kind: ProviderSuitabilityDriftKind;
  severity: "review" | "block-restricted";
  detectedAt: string;
  summary: string;
  nextAction: string;
};

export type ProviderSuitabilityDriftInput = {
  providerConnectionId: string;
  providerId: string;
  providerName: string;
  catalogReviewedAt: string | null;
  attestedAt: string | null;
  contractExpiresAt: string | null;
  regionalEntitlementExpiresAt: string | null;
  evidenceClaims: ReadonlyArray<{ claimKey: string; status: string }>;
  repeatedRouteFailures: number;
  observed: ObservedProviderPosture | null;
  attested: ObservedProviderPosture | null;
  now?: Date;
};

const DAY_MS = 86_400_000;

function ageDays(value: string | null, now: Date): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor((now.getTime() - time) / DAY_MS) : null;
}

function daysUntil(value: string | null, now: Date): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.ceil((time - now.getTime()) / DAY_MS) : null;
}

export function detectProviderSuitabilityDrift(input: ProviderSuitabilityDriftInput): ProviderSuitabilityDriftSignal[] {
  const now = input.now ?? new Date();
  const signals: ProviderSuitabilityDriftSignal[] = [];
  const add = (
    kind: ProviderSuitabilityDriftKind,
    summary: string,
    nextAction: string,
    severity: ProviderSuitabilityDriftSignal["severity"] = "review",
  ) => signals.push({
    providerConnectionId: input.providerConnectionId,
    providerId: input.providerId,
    providerName: input.providerName,
    kind,
    severity,
    detectedAt: now.toISOString(),
    summary,
    nextAction,
  });

  const catalogAge = ageDays(input.catalogReviewedAt, now);
  if (catalogAge === null || catalogAge > 180) {
    add("catalog-stale", "Provider catalog trust facts need review.", "Refresh provider catalog facts before relying on new capabilities or regions.");
  }
  const attestationAge = ageDays(input.attestedAt, now);
  if (attestationAge === null || attestationAge > 90) {
    add("attestation-stale", "The connected account posture has not been confirmed recently.", "Reconfirm the account, channel, plan, credential, and endpoint posture.");
  }

  const expiry = (value: string | null, expiring: ProviderSuitabilityDriftKind, expired: ProviderSuitabilityDriftKind, label: string) => {
    const remaining = daysUntil(value, now);
    if (remaining === null) return;
    if (remaining <= 0) add(expired, `${label} has expired.`, `Renew ${label.toLowerCase()} before restricted routing.`, "block-restricted");
    else if (remaining <= 30) add(expiring, `${label} expires in ${remaining} day${remaining === 1 ? "" : "s"}.`, `Renew ${label.toLowerCase()} before it expires.`);
  };
  expiry(input.contractExpiresAt, "contract-expiring", "contract-expired", "Provider contract evidence");
  expiry(input.regionalEntitlementExpiresAt, "regional-entitlement-expiring", "regional-entitlement-expired", "Regional entitlement evidence");

  for (const claim of input.evidenceClaims) {
    if (claim.status === "expired") add("evidence-expired", `${claim.claimKey} evidence has expired.`, "Renew or replace the expired evidence.", "block-restricted");
    if (claim.status === "rejected" || claim.status === "conflicting") add("evidence-rejected", `${claim.claimKey} evidence is ${claim.status}.`, "Resolve the evidence conflict or rejection.", "block-restricted");
  }
  if (input.repeatedRouteFailures >= 3) {
    add("repeated-route-failure", `${input.repeatedRouteFailures} recent routes failed for this provider posture.`, "Review route exclusions and retest the connection.");
  }

  const mismatch = (
    field: keyof ObservedProviderPosture,
    kind: ProviderSuitabilityDriftKind,
    label: string,
  ) => {
    const expected = input.attested?.[field];
    const actual = input.observed?.[field];
    if (expected && actual && expected !== actual) {
      add(kind, `Observed ${label} no longer matches the attested posture.`, `Review the observed ${label} and update or reject the attestation.`, "block-restricted");
    }
  };
  mismatch("executionChannel", "execution-channel-mismatch", "execution channel");
  mismatch("accountClass", "account-class-mismatch", "account class");
  mismatch("planLimit", "plan-limit-mismatch", "plan limit");
  mismatch("endpoint", "endpoint-mismatch", "endpoint");
  mismatch("credentialKind", "credential-mismatch", "credential kind");

  return signals.sort((left, right) => left.kind.localeCompare(right.kind));
}

export type SuitabilityTelemetryAdvisory = {
  recommendationDelta: number;
  reasonCodes: string[];
};

/**
 * Telemetry may tune recommendation order only. The exact hard-policy object is
 * carried through untouched so observations can never create authorization.
 */
export function applySuitabilityTelemetryAdvisory(
  policy: ProviderSuitabilityPolicy,
  advisory: SuitabilityTelemetryAdvisory,
): {
  policy: ProviderSuitabilityPolicy;
  recommendationDelta: number;
  reasonCodes: string[];
  enforcementChanged: false;
} {
  return {
    policy,
    recommendationDelta: advisory.recommendationDelta,
    reasonCodes: [...new Set(advisory.reasonCodes)].sort(),
    enforcementChanged: false,
  };
}
