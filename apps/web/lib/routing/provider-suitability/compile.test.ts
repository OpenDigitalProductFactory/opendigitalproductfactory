import { describe, expect, it } from "vitest";
import type { DataPolicyDecision } from "@/lib/govern/data/policy-decision";
import { compileAiProviderSuitabilityPolicy } from "./compile";
import {
  deriveProviderConnectionAccessPosture,
  resolveProviderTrustFacts,
} from "./provider-trust";
import { deriveAiWorkloadDataProfile } from "./workload-profile";
import type {
  AiWorkloadClassKey,
  BusinessSuitabilityProfile,
  ProviderCatalogTrustFacts,
  ProviderConnectionPosture,
  ProviderTrustFacts,
} from "./types";

const BUSINESS: BusinessSuitabilityProfile = {
  organizationId: "org-1",
  archetypeId: "general-small-business",
  archetypeCategory: "professional-services",
  operatesIn: ["us"],
  sellsTo: ["us"],
  employsIn: ["us"],
  dataResidency: [],
  riskPosture: "balanced",
};

const ALLOW_DECISION: DataPolicyDecision = {
  decisionId: "dpd-allow",
  organizationId: "org-1",
  inputHash: "hash",
  effect: "allow",
  obligations: [],
  matchedPolicyVersions: [],
  assetVersion: "1",
  classificationVersion: "1",
  authorityVersion: "1",
  explanationCode: "allowed",
  replay: "single-use",
};

function catalog(
  providerId: string,
  overrides: Partial<ProviderCatalogTrustFacts> = {},
): ProviderCatalogTrustFacts {
  return {
    providerId,
    catalogProviderId: providerId,
    category: "direct",
    jurisdictions: ["us"],
    externalEgress: "provider-cloud",
    supportsZdr: null,
    supportsNoTraining: null,
    supportsRegionalRouting: null,
    supportedRegions: [],
    regionalEndpoints: [],
    ...overrides,
  };
}

function connection(
  providerId: string,
  connectionId: string,
  overrides: Partial<ProviderConnectionPosture> = {},
): ProviderConnectionPosture {
  return {
    providerConnectionId: connectionId,
    providerId,
    executionChannel: "direct-api",
    accountClass: "regular",
    commercialBasis: "usage-metered",
    authMethod: "api-key",
    evidenceStatus: "unreviewed",
    lastReviewedAt: null,
    contractEvidence: {},
    entitlements: {},
    ...overrides,
  };
}

function trust(
  providerId: string,
  connectionId: string,
  connectionOverrides: Partial<ProviderConnectionPosture> = {},
  catalogOverrides: Partial<ProviderCatalogTrustFacts> = {},
): ProviderTrustFacts {
  return resolveProviderTrustFacts({
    catalog: catalog(providerId, catalogOverrides),
    connection: connection(providerId, connectionId, connectionOverrides),
  });
}

function compile(input: {
  workloadClasses: AiWorkloadClassKey[];
  providers: ProviderTrustFacts[];
  business?: Partial<BusinessSuitabilityProfile>;
  dataDecision?: DataPolicyDecision;
}) {
  return compileAiProviderSuitabilityPolicy({
    businessProfile: { ...BUSINESS, ...input.business },
    workloadProfiles: input.workloadClasses.map((workloadClass) =>
      deriveAiWorkloadDataProfile({ workloadClass }),
    ),
    dataPolicyDecisions: [input.dataDecision ?? ALLOW_DECISION],
    regulationResults: [],
    providerFacts: input.providers,
    source: "onboarding",
  });
}

describe("AI workload data profiles", () => {
  it.each([
    ["public-marketing", "public", "unrestricted"],
    ["health-phi", "restricted", "region-bound"],
    ["student-records", "restricted", "region-bound"],
    ["payments-finance", "restricted", "region-bound"],
    // BI-35FAE2DB follow-up: source code is INTERNAL, not confidential.
    // `confidential` auto-attaches a mask obligation, and a masked payload is
    // useless for the one thing code is sent for — being read. Genuine secrets
    // are unchanged on the line below, which is what keeps this safe.
    ["source-code", "internal", "region-bound"],
    ["secrets-credentials", "restricted", "local-only"],
  ] as const)("derives %s through the governed data vocabulary", (workloadClass, sensitivity, residencyClass) => {
    const profile = deriveAiWorkloadDataProfile({ workloadClass });
    expect(profile).toMatchObject({
      workloadClass,
      sensitivity,
      residencyClass,
      classificationKnown: true,
      purpose: "coworker-assistance",
    });
    expect(profile.assetIds[0]).toMatch(/^data:/);
    expect(profile.categories.length).toBeGreaterThan(0);
  });
});

describe("connection-scoped provider trust", () => {
  it("keeps account and contract evidence on the concrete connection", () => {
    const regular = trust("anthropic", "conn-regular");
    const enterprise = trust("anthropic", "conn-enterprise", {
      accountClass: "enterprise",
      commercialBasis: "enterprise-contract",
      evidenceStatus: "contract-uploaded",
      contractEvidence: { supplierContractId: "contract-1", baaOnFile: true },
      entitlements: { zeroRetention: true, noTraining: true },
    });

    expect(regular.contractEvidence.baaOnFile).toBeUndefined();
    expect(regular.entitlements.zeroRetention).toBeUndefined();
    expect(enterprise.contractEvidence.baaOnFile).toBe(true);
    expect(enterprise.providerConnectionId).toBe("conn-enterprise");
  });

  it.each([
    ["api", "direct-api", "regular", "usage-metered", "api-key"],
    ["subscription", "subscription-cli", "business-team", "subscription-included", "oauth"],
    ["enterprise", "cloud-tenant", "enterprise", "enterprise-contract", "workload-identity"],
    ["router", "hosted-router", "regular", "usage-metered", "api-key"],
    ["local", "local-runtime", "regular", "local-compute", "local"],
  ] as const)("derives the %s connection independently", (_label, executionChannel, accountClass, commercialBasis, authMethod) => {
    const facts = trust("provider", `conn-${executionChannel}`, {
      executionChannel,
      accountClass,
      commercialBasis,
      authMethod,
    });
    expect(facts).toMatchObject({ executionChannel, accountClass, commercialBasis, authMethod });
  });

  it.each([
    ["api", "direct", "provider-cloud", "api_key", null, false, "token", "direct-api", "usage-metered", "api-key"],
    ["subscription", "direct", "provider-cloud", "oauth2_authorization_code", "claude", false, "token", "subscription-cli", "subscription-included", "oauth"],
    ["cloud", "direct", "provider-cloud", "oauth2_client_credentials", null, true, "token", "cloud-tenant", "usage-metered", "workload-identity"],
    ["router", "router", "router-cloud", "api_key", null, false, "token", "hosted-router", "usage-metered", "api-key"],
    ["local", "local", "none", "none", "opencode", false, "compute", "local-runtime", "local-compute", "local"],
  ] as const)(
    "projects the %s channel from existing owner facts",
    (_label, providerCategory, externalEgress, modelProviderAuthMethod, cliEngine, cloudTenant, costModel, executionChannel, commercialBasis, resolvedAuth) => {
      const posture = deriveProviderConnectionAccessPosture({
        providerConnectionId: `conn-${_label}`,
        providerId: "provider",
        providerCategory,
        externalEgress,
        modelProviderAuthMethod,
        cliEngine,
        cloudTenant,
        costModel,
      });
      expect(posture).toMatchObject({
        executionChannel,
        commercialBasis,
        authMethod: resolvedAuth,
        accountClass: "unknown",
        evidenceStatus: "unreviewed",
      });
    },
  );

  it("does not infer enterprise status from a linked contract", () => {
    const posture = deriveProviderConnectionAccessPosture({
      providerConnectionId: "conn-contracted",
      providerId: "provider",
      providerCategory: "direct",
      externalEgress: "provider-cloud",
      modelProviderAuthMethod: "api_key",
      costModel: "token",
      contractEvidence: { supplierContractId: "contract-1" },
    });
    expect(posture.accountClass).toBe("unknown");
    expect(posture.commercialBasis).toBe("usage-metered");
  });

  it("does not turn a vendor capability into a connected-account entitlement", () => {
    const result = compile({
      workloadClasses: ["source-code"],
      providers: [trust(
        "provider",
        "conn-team",
        { accountClass: "business-team", evidenceStatus: "operator-attested" },
        { supportsNoTraining: true },
      )],
    });
    expect(result.effect).toBe("deny");
    expect(result.deniedProviderConnectionIds).toEqual(["conn-team"]);
    expect(result.explanations).toContainEqual(expect.objectContaining({
      code: "business-account-unproven",
    }));
  });

  it("changes the policy identity when connection evidence changes", () => {
    const before = compile({
      workloadClasses: ["source-code"],
      providers: [trust("provider", "conn-team", {
        accountClass: "business-team",
        evidenceStatus: "operator-attested",
      })],
    });
    const after = compile({
      workloadClasses: ["source-code"],
      providers: [trust("provider", "conn-team", {
        accountClass: "business-team",
        evidenceStatus: "operator-attested",
        entitlements: { noTraining: true },
      })],
    });
    expect(after.policyId).not.toBe(before.policyId);
  });
});

describe("compileAiProviderSuitabilityPolicy", () => {
  const local = () => trust("local", "conn-local", {}, {
    category: "local",
    jurisdictions: ["local"],
    externalEgress: "none",
  });

  it("keeps dental PHI local unless a healthcare contract is proven", () => {
    const result = compile({
      workloadClasses: ["health-phi"],
      business: { archetypeId: "dental-practice", archetypeCategory: "healthcare-wellness" },
      providers: [
        local(),
        trust("anthropic", "conn-regular"),
        trust("azure-openai", "conn-health", {
          accountClass: "enterprise",
          commercialBasis: "enterprise-contract",
          evidenceStatus: "contract-uploaded",
          contractEvidence: { supplierContractId: "contract-health", baaOnFile: true, dpaOnFile: true },
          entitlements: { noTraining: true, zeroRetention: true },
        }),
      ],
    });

    expect(result.allowedProviders).toEqual(["azure-openai", "local"]);
    expect(result.deniedProviders).toEqual(["anthropic"]);
    expect(result.effect).toBe("allow");
  });

  it("allows ordinary hosted providers for public retail marketing", () => {
    const result = compile({
      workloadClasses: ["public-marketing"],
      business: { archetypeId: "retail-store", archetypeCategory: "retail" },
      providers: [local(), trust("openai", "conn-openai"), trust("openrouter", "conn-router", {}, {
        category: "router",
        externalEgress: "router-cloud",
      })],
    });
    expect(result.effect).toBe("allow");
    expect(result.allowedProviders).toEqual(["local", "openai", "openrouter"]);
    expect(result.residencyPolicy).toBe("any_enabled");
  });

  it("keeps OpenRouter execution obligations bound to the one attested connection", () => {
    const result = compile({
      workloadClasses: ["customer-records"],
      providers: [trust("openrouter", "conn-router", {
        accountClass: "enterprise",
        evidenceStatus: "contract-uploaded",
        entitlements: {
          zeroRetention: true,
          noTraining: true,
          approvedUnderlyingProviderSlugs: ["anthropic", "google-vertex/europe-west4"],
        },
      }, {
        category: "router",
        externalEgress: "router-cloud",
        routerPassThrough: {
          exposesUnderlyingProvider: true,
          supportsProviderAllowlist: true,
          supportsProviderBlocklist: true,
          supportsZdrFilter: true,
          supportsDataCollectionDeny: true,
          supportsBoundedFallbacks: true,
        },
      })],
    });
    expect(result.openRouterObligations).toMatchObject({
      providerConnectionId: "conn-router",
      accountClass: "enterprise",
      approvedEndpointSlugs: ["anthropic", "google-vertex/europe-west4"],
      requireZdr: true,
      denyDataCollection: true,
      requireBoundedFallbacks: true,
    });
  });

  it("requires financial review evidence for a credit union cloud route", () => {
    const result = compile({
      workloadClasses: ["payments-finance"],
      business: { archetypeId: "credit-union", archetypeCategory: "banking-financial-services" },
      providers: [local(), trust("openai", "conn-finance", {
        accountClass: "enterprise",
        commercialBasis: "enterprise-contract",
        evidenceStatus: "contract-uploaded",
        contractEvidence: {
          supplierContractId: "contract-finance",
          financialCustomerInfoReviewedAt: "2026-07-01T00:00:00.000Z",
        },
        entitlements: { noTraining: true },
      })],
    });
    expect(result.allowedProviders).toEqual(["local", "openai"]);
  });

  it("leaves a training-company cloud route under review without student-data terms", () => {
    const result = compile({
      workloadClasses: ["student-records"],
      business: { archetypeId: "training-company", archetypeCategory: "education-training" },
      providers: [local(), trust("openai", "conn-training")],
    });
    expect(result.effect).toBe("review");
    expect(result.allowedProviders).toEqual(["local"]);
    expect(result.deniedProviders).toEqual(["openai"]);
    expect(result.explanations.some((item) => item.code === "student-terms-unproven")).toBe(true);
  });

  it("keeps source code off an unproven personal account", () => {
    const result = compile({
      workloadClasses: ["source-code"],
      business: { archetypeId: "software-platform", archetypeCategory: "software-platform" },
      providers: [local(), trust("anthropic-sub", "conn-personal"), trust("anthropic", "conn-team", {
        accountClass: "business-team",
        evidenceStatus: "operator-attested",
        entitlements: { noTraining: true },
      })],
    });
    expect(result.allowedProviders).toEqual(["anthropic", "local"]);
    expect(result.deniedProviders).toEqual(["anthropic-sub"]);
  });

  it("forces credentials to a non-egress connection", () => {
    const result = compile({
      workloadClasses: ["secrets-credentials"],
      providers: [local(), trust("openai", "conn-openai")],
    });
    expect(result.residencyPolicy).toBe("local_only");
    expect(result.allowedProviders).toEqual(["local"]);
    expect(result.deniedProviders).toEqual(["openai"]);
  });

  it("fails unknown classification closed to local and review", () => {
    const unknown = deriveAiWorkloadDataProfile({ workloadClass: "customer-records" });
    unknown.classificationKnown = false;
    const result = compileAiProviderSuitabilityPolicy({
      businessProfile: BUSINESS,
      workloadProfiles: [unknown],
      dataPolicyDecisions: [ALLOW_DECISION],
      regulationResults: [],
      providerFacts: [local(), trust("openai", "conn-openai")],
      source: "onboarding",
    });
    expect(result.effect).toBe("review");
    expect(result.allowedProviders).toEqual(["local"]);
    expect(result.explanations.some((item) => item.code === "classification-unknown")).toBe(true);
  });

  it("returns deny and no route when residency has no eligible connection", () => {
    const result = compile({
      workloadClasses: ["health-phi"],
      business: { dataResidency: ["eu"] },
      providers: [trust("openai", "conn-us")],
    });
    expect(result.effect).toBe("deny");
    expect(result.allowedProviders).toEqual([]);
    expect(result.deniedProviders).toEqual(["openai"]);
  });

  it("never transfers enterprise rights between two accounts for one provider slug", () => {
    const result = compile({
      workloadClasses: ["health-phi"],
      providers: [
        trust("anthropic", "conn-regular"),
        trust("anthropic", "conn-enterprise", {
          accountClass: "enterprise",
          commercialBasis: "enterprise-contract",
          evidenceStatus: "contract-uploaded",
          contractEvidence: { supplierContractId: "contract-1", baaOnFile: true },
          entitlements: { noTraining: true },
        }),
      ],
    });
    expect(result.allowedProviderConnectionIds).toEqual(["conn-enterprise"]);
    expect(result.deniedProviderConnectionIds).toEqual(["conn-regular"]);
    expect(result.allowedProviders).toEqual([]);
    expect(result.effect).toBe("review");
    expect(result.explanations.some((item) => item.code === "provider-connection-ambiguous")).toBe(true);
  });

  it("preserves a deny from the governed data PDP", () => {
    const result = compile({
      workloadClasses: ["customer-records"],
      providers: [local(), trust("openai", "conn-openai")],
      dataDecision: { ...ALLOW_DECISION, effect: "deny", explanationCode: "processing-authority-missing" },
    });
    expect(result.effect).toBe("deny");
    expect(result.allowedProviders).toEqual([]);
  });

  it("requires review when a regulation is unresolved because its jurisdiction basis is undeclared", () => {
    const result = compileAiProviderSuitabilityPolicy({
      businessProfile: BUSINESS,
      workloadProfiles: [deriveAiWorkloadDataProfile({ workloadClass: "public-marketing" })],
      dataPolicyDecisions: [ALLOW_DECISION],
      regulationResults: [{
        regulationId: "regulation:example",
        applicability: {
          applies: false,
          reason: "Selling jurisdiction is not declared.",
          matchedBasis: [],
          undeclared: true,
        },
      }],
      providerFacts: [local(), trust("openai", "conn-openai")],
      source: "onboarding",
    });
    expect(result.effect).toBe("review");
    expect(result.explanations).toContainEqual(expect.objectContaining({
      code: "regulation-applicability-unknown",
    }));
  });

  it("honors a stricter Golden Triangle residency posture without relaxing workload policy", () => {
    const result = compileAiProviderSuitabilityPolicy({
      businessProfile: BUSINESS,
      workloadProfiles: [deriveAiWorkloadDataProfile({ workloadClass: "public-marketing" })],
      dataPolicyDecisions: [ALLOW_DECISION],
      regulationResults: [],
      providerFacts: [local(), trust("openai", "conn-openai")],
      source: "onboarding",
      activityClass: "owner-advice",
      goldenTrianglePosture: { residencyPolicy: "local_only" },
    });
    expect(result.residencyPolicy).toBe("local_only");
    expect(result.allowedProviders).toEqual(["local"]);
    expect(result.deniedProviders).toEqual(["openai"]);
  });
});
