import { compileAiProviderSuitabilityPolicy } from "./compile";
import type { ProviderTrustClaimKey } from "./evidence";
import { deriveOnboardingWorkloadClasses } from "./onboarding-recommendation";
import type {
  AiWorkloadClassKey,
  BusinessSuitabilityProfile,
  ProviderSuitabilityExplanation,
  ProviderTrustFacts,
} from "./types";
import { deriveAiWorkloadDataProfile } from "./workload-profile";

export type ProviderConnectionReview = {
  scope: "company-work" | "public-only" | "blocked";
  headline: string;
  summary: string;
  requiredRegions: string[];
  requiredClaimKeys: ProviderTrustClaimKey[];
  explanationCodes: string[];
  actions: string[];
};

type Requirement = {
  claims: ProviderTrustClaimKey[];
  actions: string[];
};

const EXPLANATION_REQUIREMENTS: Readonly<Record<string, Requirement>> = {
  "residency-unproven": {
    claims: ["regional-processing", "enabled-regions"],
    actions: ["Confirm that this connected account guarantees processing in every required region."],
  },
  "router-controls-unproven": {
    claims: ["zero-retention", "approved-underlying-providers"],
    actions: ["Bound the router to reviewed providers and enable zero-retention controls."],
  },
  "business-account-unproven": {
    claims: ["no-training"],
    actions: ["Confirm a business or enterprise account with no-training treatment."],
  },
  "healthcare-contract-unproven": {
    claims: ["baa-on-file", "no-training"],
    actions: ["Link a current supplier contract and reviewed Business Associate Agreement."],
  },
  "student-terms-unproven": {
    claims: ["student-data-terms-reviewed-at", "no-training"],
    actions: ["Link a current supplier contract and reviewed student-data terms."],
  },
  "financial-oversight-unproven": {
    claims: ["financial-customer-info-reviewed-at", "no-training"],
    actions: ["Link a current supplier contract and reviewed customer-information controls."],
  },
  "restricted-contract-unproven": {
    claims: ["no-training"],
    actions: ["Link a current supplier contract and confirm no-training treatment."],
  },
};

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function compileFor(input: {
  businessProfile: BusinessSuitabilityProfile;
  facts: ProviderTrustFacts;
  workloads: AiWorkloadClassKey[];
}) {
  return compileAiProviderSuitabilityPolicy({
    businessProfile: input.businessProfile,
    workloadProfiles: input.workloads.map((reviewWorkloadClass) =>
      deriveAiWorkloadDataProfile({ workloadClass: reviewWorkloadClass }),
    ),
    dataPolicyDecisions: [],
    regulationResults: [],
    providerFacts: [input.facts],
    source: "onboarding",
  });
}

function requirements(explanations: ProviderSuitabilityExplanation[]): Requirement {
  const mapped = explanations.flatMap((explanation) => {
    const requirement = EXPLANATION_REQUIREMENTS[explanation.code];
    return requirement ? [requirement] : [];
  });
  return {
    claims: sortedUnique(mapped.flatMap((item) => item.claims)),
    actions: sortedUnique(mapped.flatMap((item) => item.actions)),
  };
}

/** UI read model over the same compiler that governs actual provider routing. */
export function projectProviderConnectionReview(input: {
  businessProfile: BusinessSuitabilityProfile;
  businessContextConfigured: boolean;
  handlesCardPayments: boolean;
  facts: ProviderTrustFacts;
}): ProviderConnectionReview {
  const publicPolicy = compileFor({
    businessProfile: { ...input.businessProfile, dataResidency: [] },
    facts: input.facts,
    workloads: ["public-marketing"],
  });
  const companyWorkloads = deriveOnboardingWorkloadClasses({
    archetypeCategory: input.businessProfile.archetypeCategory,
    handlesCardPayments: input.handlesCardPayments,
  }).filter((workload) => workload !== "public-marketing");
  const companyPolicy = compileFor({
    businessProfile: input.businessProfile,
    facts: input.facts,
    workloads: companyWorkloads,
  });
  const companyExplanations = companyPolicy.explanations.filter(
    (explanation) => explanation.providerConnectionId === input.facts.providerConnectionId,
  );
  const needed = requirements(companyExplanations);
  const publicUsable = publicPolicy.effect !== "deny";
  const companyUsable = input.businessContextConfigured && companyPolicy.effect !== "deny";

  if (companyUsable) {
    return {
      scope: "company-work",
      headline: "No action needed",
      summary: "This connection is ready for the company work represented by the current business setup. Each request is still checked when it runs.",
      requiredRegions: sortedUnique(input.businessProfile.dataResidency.map((region) => region.toLowerCase())),
      requiredClaimKeys: [],
      explanationCodes: [],
      actions: [],
    };
  }

  const contextAction = input.businessContextConfigured
    ? []
    : ["Complete business setup before using this connection for company work."];
  const summary = publicUsable
    ? input.businessContextConfigured
      ? "Public or synthetic work can be used now. Company work stays blocked until the required account evidence is current."
      : "Public or synthetic work can be used now. Company-work eligibility is unproven because business setup is incomplete."
    : "This connection does not currently meet the policy for public or company work.";
  return {
    scope: publicUsable ? "public-only" : "blocked",
    headline: publicUsable ? "Company work needs attention" : "Connection blocked for current work",
    summary,
    requiredRegions: sortedUnique(input.businessProfile.dataResidency.map((region) => region.toLowerCase())),
    requiredClaimKeys: needed.claims,
    explanationCodes: sortedUnique(companyExplanations.map((explanation) => explanation.code)),
    actions: [...contextAction, ...needed.actions],
  };
}
