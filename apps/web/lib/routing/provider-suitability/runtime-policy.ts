import type { RequestContract } from "../request-contract";
import type { ProviderSuitabilityPolicy } from "./types";
import type { ProviderSuitabilityRollout } from "./telemetry";

const SELECTED_VERTICALS = new Set([
  "healthcare-wellness",
  "banking-financial-services",
  "education-training",
  "public-sector",
  "software-platform",
]);

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function intersection(left: readonly string[] | undefined, right: readonly string[]): string[] {
  if (!left) return sortedUnique(right);
  const allowed = new Set(right);
  return sortedUnique(left.filter((value) => allowed.has(value)));
}

function stricterResidency(
  left: RequestContract["residencyPolicy"],
  right: ProviderSuitabilityPolicy["residencyPolicy"],
): NonNullable<RequestContract["residencyPolicy"]> {
  const rank = { any_enabled: 0, approved_cloud: 1, local_only: 2 } as const;
  const current = left ?? "any_enabled";
  return rank[current] >= rank[right] ? current : right;
}

export type ProviderSuitabilityRuntimeBinding = {
  contract: RequestContract;
  mode: "shadow" | "preview" | "enforced";
  policyRuleId: string;
};

/**
 * Bind the compiler result to the one canonical RequestContract consumed by
 * routeEndpointV2. Existing caller/operator constraints can only become
 * narrower: allowlists intersect, denials accumulate, and residency takes the
 * stricter value.
 */
export function applyProviderSuitabilityPolicyToContract(input: {
  contract: RequestContract;
  policy: ProviderSuitabilityPolicy;
  rollout: ProviderSuitabilityRollout;
  archetypeCategory: string | null;
  /** Canonical active accounts. Omission retains legacy provider-only ambiguity protection. */
  accountCandidates?: Array<{ providerId: string; connectionId: string }>;
}): ProviderSuitabilityRuntimeBinding {
  const selectedVertical = input.archetypeCategory !== null && SELECTED_VERTICALS.has(input.archetypeCategory);
  const restrictedOpenRouter = input.rollout.restrictedOpenRouter &&
    input.policy.openRouterObligations !== null &&
    input.contract.sensitivity !== "public";
  const enforce = input.rollout.evidenceEnforcement ||
    (input.rollout.selectedVerticalBindings && selectedVertical) ||
    restrictedOpenRouter;
  const mode: ProviderSuitabilityRuntimeBinding["mode"] = enforce
    ? "enforced"
    : input.rollout.adminPreview ? "preview" : "shadow";
  const policyRuleId = `provider-suitability:${input.policy.policyId}:${mode}`;
  if (!enforce) return { contract: input.contract, mode, policyRuleId };

  const allowedAccounts = intersection(input.contract.allowedProviderConnectionIds, input.policy.allowedProviderConnectionIds);
  const deniedAccounts = sortedUnique([...(input.contract.deniedProviderConnectionIds ?? []), ...input.policy.deniedProviderConnectionIds]);
  const approvedProviders = input.accountCandidates
    ? sortedUnique(input.accountCandidates.filter(account => allowedAccounts.includes(account.connectionId) && !deniedAccounts.includes(account.connectionId)).map(account => account.providerId))
    : input.policy.allowedProviders;
  const providerDenials = input.accountCandidates
    ? input.policy.deniedProviders.filter(providerId => !approvedProviders.includes(providerId))
    : input.policy.deniedProviders;

  return {
    mode,
    policyRuleId,
    contract: {
      ...input.contract,
      allowedProviders: intersection(input.contract.allowedProviders, approvedProviders),
      deniedProviders: sortedUnique([
        ...(input.contract.deniedProviders ?? []),
        ...providerDenials,
      ]),
      ...(input.accountCandidates ? { allowedProviderConnectionIds: allowedAccounts, deniedProviderConnectionIds: deniedAccounts } : {}),
      residencyPolicy: stricterResidency(input.contract.residencyPolicy, input.policy.residencyPolicy),
      ...(input.policy.openRouterObligations
        ? { openRouterObligations: input.policy.openRouterObligations }
        : {}),
    },
  };
}
