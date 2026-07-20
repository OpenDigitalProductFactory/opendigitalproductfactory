import type { ProviderSuitabilityPolicy } from "./routing/provider-suitability/types";
import type { RequestContract } from "./routing/request-contract";

export type ProviderSuitabilityRouteContext = {
  allowedProviders?: string[];
  deniedProviders?: string[];
  residencyPolicy?: RequestContract["residencyPolicy"];
};

function normalizeProviderIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

const RESIDENCY_RANK: Readonly<Record<NonNullable<RequestContract["residencyPolicy"]>, number>> = {
  any_enabled: 0,
  approved_cloud: 1,
  local_only: 2,
};

/**
 * Compose a compiled suitability policy into the caller overrides consumed by
 * inferContract(). Existing hard bounds can only become stricter: allowlists
 * intersect, denials union, and the strongest residency posture wins.
 */
export function applyProviderSuitabilityRouteContext<T extends Record<string, unknown>>(
  routeContext: T & ProviderSuitabilityRouteContext,
  policy: ProviderSuitabilityPolicy,
): T & Required<ProviderSuitabilityRouteContext> {
  const policyAllowed = normalizeProviderIds(policy.allowedProviders);
  const existingAllowed = routeContext.allowedProviders === undefined
    ? null
    : normalizeProviderIds(routeContext.allowedProviders);
  const allowedProviders = policy.effect === "deny"
    ? []
    : existingAllowed === null
      ? policyAllowed
      : existingAllowed.filter((providerId) => policyAllowed.includes(providerId));
  const deniedProviders = normalizeProviderIds([
    ...(routeContext.deniedProviders ?? []),
    ...policy.deniedProviders,
  ]);
  const existingResidency = routeContext.residencyPolicy ?? "any_enabled";
  const residencyPolicy = RESIDENCY_RANK[existingResidency] >= RESIDENCY_RANK[policy.residencyPolicy]
    ? existingResidency
    : policy.residencyPolicy;

  return {
    ...routeContext,
    allowedProviders,
    deniedProviders,
    residencyPolicy,
  };
}

export function inferProviderIdFromRouteContext(routeContext?: string | null): string | null {
  const match = routeContext?.match(/^\/platform\/ai\/providers\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function applyProviderRouteModelPreference<T extends Record<string, unknown>>(
  modelRequirements: T,
  routeContext?: string | null,
): T & { preferredProviderId?: string } {
  const providerId = inferProviderIdFromRouteContext(routeContext);
  if (!providerId) return { ...modelRequirements };

  const next = {
    ...modelRequirements,
    preferredProviderId: providerId,
  } as T & { preferredProviderId: string; preferredModelId?: string };

  delete next.preferredModelId;
  return next;
}
