import type {
  AiWorkloadDataProfile,
  CompileProviderSuitabilityInput,
  OpenRouterPolicyObligations,
  ProviderSuitabilityExplanation,
  ProviderSuitabilityPolicy,
  ProviderTrustFacts,
} from "./types";

export const PROVIDER_SUITABILITY_COMPILER_VERSION = "1.0.0";

type ConnectionVerdict = {
  allowed: boolean;
  explanation?: ProviderSuitabilityExplanation;
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function stableHash(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  let hash = 5381;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) + hash) ^ json.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isLocal(facts: ProviderTrustFacts): boolean {
  return facts.externalEgress === "none" || facts.executionChannel === "local-runtime";
}

function hasCurrentEvidence(facts: ProviderTrustFacts): boolean {
  return facts.evidenceStatus === "operator-attested" || facts.evidenceStatus === "contract-uploaded";
}

function hasContract(facts: ProviderTrustFacts): boolean {
  return Boolean(facts.contractEvidence.supplierContractId) && hasCurrentEvidence(facts);
}

function hasNoTraining(facts: ProviderTrustFacts): boolean {
  return facts.entitlements.noTraining === true;
}

function regionEligible(facts: ProviderTrustFacts, requiredRegions: string[]): boolean {
  if (requiredRegions.length === 0 || isLocal(facts)) return true;
  if (facts.supportsRegionalRouting !== true || facts.entitlements.regionalProcessing !== true) return false;
  const enabled = new Set((facts.entitlements.enabledRegions ?? []).map((region) => region.toLowerCase()));
  return requiredRegions.every((region) => enabled.has(region.toLowerCase()));
}

function routerEligible(facts: ProviderTrustFacts): boolean {
  if (facts.category !== "router") return true;
  const passThrough = facts.routerPassThrough;
  return Boolean(
    passThrough?.exposesUnderlyingProvider &&
      passThrough.supportsProviderAllowlist &&
      passThrough.supportsProviderBlocklist &&
      passThrough.supportsZdrFilter &&
      passThrough.supportsDataCollectionDeny &&
      passThrough.supportsBoundedFallbacks &&
      facts.entitlements.zeroRetention === true,
  );
}

function deny(
  facts: ProviderTrustFacts,
  code: string,
  message: string,
): ConnectionVerdict {
  return {
    allowed: false,
    explanation: {
      code,
      message,
      providerId: facts.providerId,
      providerConnectionId: facts.providerConnectionId,
    },
  };
}

function evaluateConnection(
  facts: ProviderTrustFacts,
  profiles: AiWorkloadDataProfile[],
  requiredRegions: string[],
  postureRequiresLocal: boolean,
): ConnectionVerdict {
  if (facts.evidenceStatus === "expired" || facts.evidenceStatus === "rejected") {
    return deny(facts, "provider-evidence-invalid", "Provider evidence is expired or rejected.");
  }
  if (profiles.some((profile) => !profile.classificationKnown) && !isLocal(facts)) {
    return deny(facts, "classification-unknown", "Unknown data classification stays on a non-egress connection pending review.");
  }
  if ((postureRequiresLocal || profiles.some((profile) => profile.residencyClass === "local-only")) && !isLocal(facts)) {
    return deny(facts, "local-only-required", "This workload is restricted to a non-egress connection.");
  }
  if (!regionEligible(facts, requiredRegions)) {
    return deny(facts, "residency-unproven", "The connection has no proven entitlement for the required processing region.");
  }
  if (isLocal(facts)) return { allowed: true };

  if (!routerEligible(facts) && facts.category === "router" && profiles.some((profile) => profile.sensitivity !== "public")) {
    return deny(facts, "router-controls-unproven", "Restricted work requires bounded router providers, no collection, and proven zero retention.");
  }

  const classes = new Set(profiles.map((profile) => profile.workloadClass));
  if (classes.has("secrets-credentials")) {
    return deny(facts, "credentials-must-not-egress", "Credentials and secrets must not leave the controlled runtime.");
  }
  if (classes.has("health-phi")) {
    if (!hasContract(facts) || facts.contractEvidence.baaOnFile !== true || !hasNoTraining(facts)) {
      return deny(facts, "healthcare-contract-unproven", "Health information requires a proven contract, BAA, and no-training entitlement.");
    }
  }
  if (classes.has("student-records")) {
    if (!hasContract(facts) || !facts.contractEvidence.studentDataTermsReviewedAt || !hasNoTraining(facts)) {
      return deny(facts, "student-terms-unproven", "Student records require reviewed student-data terms and a no-training entitlement.");
    }
  }
  if (classes.has("payments-finance")) {
    if (!hasContract(facts) || !facts.contractEvidence.financialCustomerInfoReviewedAt || !hasNoTraining(facts)) {
      return deny(facts, "financial-oversight-unproven", "Financial records require a linked contract, reviewed customer-information controls, and no-training entitlement.");
    }
  }
  if (classes.has("source-code")) {
    const approvedAccount = facts.accountClass === "business-team" || facts.accountClass === "enterprise";
    if (!approvedAccount || !hasCurrentEvidence(facts) || !hasNoTraining(facts)) {
      return deny(facts, "business-account-unproven", "Source code requires a business or enterprise connection with proven no-training treatment.");
    }
  }

  const otherRestricted = profiles.some(
    (profile) =>
      profile.sensitivity === "restricted" &&
      !["health-phi", "student-records", "payments-finance", "secrets-credentials"].includes(profile.workloadClass),
  );
  if (otherRestricted && (!hasContract(facts) || !hasNoTraining(facts))) {
    return deny(facts, "restricted-contract-unproven", "Restricted data requires a linked contract and proven no-training treatment.");
  }

  return { allowed: true };
}

function residencyPolicy(input: CompileProviderSuitabilityInput): ProviderSuitabilityPolicy["residencyPolicy"] {
  let derived: ProviderSuitabilityPolicy["residencyPolicy"];
  if (input.workloadProfiles.some((profile) => !profile.classificationKnown || profile.residencyClass === "local-only")) {
    derived = "local_only";
  } else if (
    input.businessProfile.dataResidency.length > 0 ||
    input.workloadProfiles.some(
      (profile) => profile.residencyClass === "region-bound" || profile.sensitivity === "confidential" || profile.sensitivity === "restricted",
    )
  ) {
    derived = "approved_cloud";
  } else {
    derived = "any_enabled";
  }

  const requested = input.goldenTrianglePosture?.residencyPolicy ?? "any_enabled";
  const rank: Record<ProviderSuitabilityPolicy["residencyPolicy"], number> = {
    any_enabled: 0,
    approved_cloud: 1,
    local_only: 2,
  };
  return rank[requested] > rank[derived] ? requested : derived;
}

function openRouterObligations(input: CompileProviderSuitabilityInput): OpenRouterPolicyObligations | null {
  if (!input.providerFacts.some((facts) => facts.category === "router")) return null;
  const restricted = input.workloadProfiles.some((profile) => profile.sensitivity !== "public");
  return {
    requireProviderAllowlist: restricted,
    requireProviderBlocklist: restricted,
    requireZdr: restricted,
    denyDataCollection: restricted,
    requireBoundedFallbacks: restricted,
    requiredRegion: input.businessProfile.dataResidency[0]?.toLowerCase() ?? null,
  };
}

export function compileAiProviderSuitabilityPolicy(
  input: CompileProviderSuitabilityInput,
): ProviderSuitabilityPolicy {
  const policySeed = {
    organizationId: input.businessProfile.organizationId,
    businessProfile: {
      archetypeId: input.businessProfile.archetypeId,
      archetypeCategory: input.businessProfile.archetypeCategory,
      operatesIn: sortedUnique(input.businessProfile.operatesIn),
      sellsTo: sortedUnique(input.businessProfile.sellsTo),
      employsIn: sortedUnique(input.businessProfile.employsIn),
      dataResidency: sortedUnique(input.businessProfile.dataResidency),
      riskPosture: input.businessProfile.riskPosture,
    },
    source: input.source,
    activityClass: input.activityClass ?? null,
    workloads: input.workloadProfiles
      .map((profile) => [
        profile.workloadClass,
        profile.classificationKnown,
        profile.sensitivity,
        profile.residencyClass,
        sortedUnique(profile.applicableRegulationIds),
      ])
      .sort(),
    dataPolicyDecisions: input.dataPolicyDecisions
      .map((decision) => [decision.decisionId, decision.inputHash, decision.effect])
      .sort(),
    providers: input.providerFacts
      .map((facts) => [
        facts.providerId,
        facts.providerConnectionId,
        facts.accountClass,
        facts.evidenceStatus,
        facts.lastReviewedAt,
        facts.contractEvidence,
        facts.entitlements,
      ])
      .sort(),
    regulationResults: input.regulationResults
      .map(({ regulationId, applicability }) => [regulationId, applicability.applies, applicability.undeclared])
      .sort(),
    goldenTriangleResidency: input.goldenTrianglePosture?.residencyPolicy ?? null,
  };

  if (input.dataPolicyDecisions.some((decision) => decision.effect === "deny")) {
    return {
      policyId: `aips-${stableHash(policySeed)}`,
      organizationId: input.businessProfile.organizationId,
      source: input.source,
      effect: "deny",
      allowedProviders: [],
      deniedProviders: sortedUnique(input.providerFacts.map((facts) => facts.providerId)),
      allowedProviderConnectionIds: [],
      deniedProviderConnectionIds: sortedUnique(input.providerFacts.map((facts) => facts.providerConnectionId)),
      residencyPolicy: residencyPolicy(input),
      openRouterObligations: openRouterObligations(input),
      explanations: [{ code: "data-policy-deny", message: "The governed data policy decision denies this processing." }],
      compilerVersion: PROVIDER_SUITABILITY_COMPILER_VERSION,
    };
  }

  const verdicts = input.providerFacts.map((facts) => ({
    facts,
    verdict: evaluateConnection(
      facts,
      input.workloadProfiles,
      input.businessProfile.dataResidency,
      input.goldenTrianglePosture?.residencyPolicy === "local_only",
    ),
  }));
  const allowedConnections = verdicts.filter(({ verdict }) => verdict.allowed);
  const deniedConnections = verdicts.filter(({ verdict }) => !verdict.allowed);
  const explanations = deniedConnections.flatMap(({ verdict }) => verdict.explanation ? [verdict.explanation] : []);

  const providerGroups = new Map<string, typeof verdicts>();
  for (const item of verdicts) {
    providerGroups.set(item.facts.providerId, [...(providerGroups.get(item.facts.providerId) ?? []), item]);
  }

  const allowedProviders: string[] = [];
  const deniedProviders: string[] = [];
  let ambiguous = false;
  for (const [providerId, group] of providerGroups) {
    const allowedCount = group.filter(({ verdict }) => verdict.allowed).length;
    if (allowedCount === group.length) {
      allowedProviders.push(providerId);
    } else {
      deniedProviders.push(providerId);
      if (allowedCount > 0) {
        ambiguous = true;
        explanations.push({
          code: "provider-connection-ambiguous",
          message: "This provider has both approved and unapproved connections; provider-level routing remains blocked until a connection is selected explicitly.",
          providerId,
        });
      }
    }
  }

  const classificationUnknown = input.workloadProfiles.some((profile) => !profile.classificationKnown);
  const dataReview = input.dataPolicyDecisions.some(
    (decision) => decision.effect === "review" || decision.effect === "allow-with-obligations",
  );
  const regulationReview = input.regulationResults.some(({ applicability }) => applicability.undeclared);
  for (const { regulationId, applicability } of input.regulationResults) {
    if (applicability.undeclared) {
      explanations.push({
        code: "regulation-applicability-unknown",
        message: `${regulationId} needs a declared jurisdiction basis before hosted processing can be approved.`,
      });
    }
  }
  const restrictedHostedUnavailable = input.workloadProfiles.some(
    (profile) => profile.residencyClass === "region-bound" && profile.sensitivity === "restricted",
  ) && !allowedConnections.some(({ facts }) => !isLocal(facts));

  let effect: ProviderSuitabilityPolicy["effect"] = "allow";
  if (allowedProviders.length === 0 && allowedConnections.length === 0) effect = "deny";
  else if (classificationUnknown || dataReview || regulationReview || ambiguous || restrictedHostedUnavailable) effect = "review";

  return {
    policyId: `aips-${stableHash(policySeed)}`,
    organizationId: input.businessProfile.organizationId,
    source: input.source,
    effect,
    allowedProviders: sortedUnique(allowedProviders),
    deniedProviders: sortedUnique(deniedProviders),
    allowedProviderConnectionIds: sortedUnique(
      allowedConnections.map(({ facts }) => facts.providerConnectionId),
    ),
    deniedProviderConnectionIds: sortedUnique(
      deniedConnections.map(({ facts }) => facts.providerConnectionId),
    ),
    residencyPolicy: residencyPolicy(input),
    openRouterObligations: openRouterObligations(input),
    explanations,
    compilerVersion: PROVIDER_SUITABILITY_COMPILER_VERSION,
  };
}
