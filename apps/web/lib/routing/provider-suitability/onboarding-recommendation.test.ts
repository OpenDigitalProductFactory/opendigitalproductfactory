import { describe, expect, it } from "vitest";
import { buildProviderOnboardingRecommendation, resolveRuntimeConnectionStatus } from "./onboarding-recommendation";
import type { BusinessSuitabilityProfile, ProviderTrustFacts } from "./types";

const business: BusinessSuitabilityProfile = {
  organizationId: "org-1",
  archetypeId: null,
  archetypeCategory: "software",
  operatesIn: ["eu"],
  sellsTo: ["eu"],
  employsIn: [],
  dataResidency: ["eu"],
  riskPosture: "conservative",
};

function facts(overrides: Partial<ProviderTrustFacts>): ProviderTrustFacts {
  return {
    providerId: "provider",
    catalogProviderId: "provider",
    providerConnectionId: "conn-1",
    category: "direct",
    jurisdictions: [],
    externalEgress: "provider-cloud",
    supportsZdr: null,
    supportsNoTraining: null,
    supportsRegionalRouting: null,
    supportedRegions: [],
    regionalEndpoints: [],
    executionChannel: "direct-api",
    accountClass: "unknown",
    commercialBasis: "unknown",
    authMethod: "api-key",
    contractEvidence: {},
    entitlements: {},
    evidenceStatus: "unreviewed",
    lastReviewedAt: null,
    ...overrides,
  };
}

describe("provider onboarding recommendation", () => {
  it("uses runtime provider activation without reviving a disabled connection", () => {
    expect(resolveRuntimeConnectionStatus("active", "unconfigured")).toBe("active");
    expect(resolveRuntimeConnectionStatus("active", "disabled")).toBe("disabled");
    expect(resolveRuntimeConnectionStatus("inactive", "active")).toBe("inactive");
  });
  it("limits an unreviewed personal or unknown cloud connection to public or synthetic work", () => {
    const result = buildProviderOnboardingRecommendation({
      businessProfile: business,
      connections: [{ label: "Personal provider", status: "active", facts: facts({ accountClass: "regular" }) }],
      handlesCardPayments: false,
    });

    expect(result.status).toBe("review-needed");
    expect(result.useNow).toEqual([expect.objectContaining({ scope: "public-only" })]);
    expect(result.whatDpfBlocks).toContain("company, customer, employee, source-code, or regulated data");
    expect(result.nextAction).toContain("business or enterprise");
    expect(result.reviewPacket).toMatchObject({
      schemaVersion: "provider-compliance-review.v1",
      organizationRef: "org-1",
      recommendation: { status: "review-needed" },
      providerConnections: [{ providerConnectionId: "conn-1", providerId: "provider" }],
    });
  });

  it("recommends a proven business connection for the derived company workloads", () => {
    const result = buildProviderOnboardingRecommendation({
      businessProfile: { ...business, dataResidency: [] },
      connections: [{
        label: "Team API", status: "active",
        facts: facts({
          accountClass: "business-team",
          evidenceStatus: "operator-attested",
          entitlements: { noTraining: true },
        }),
      }],
      handlesCardPayments: false,
    });

    expect(result.status).toBe("ready");
    expect(result.useNow).toEqual([expect.objectContaining({ scope: "company-work" })]);
  });

  it("keeps local processing available without claiming the local model is compliant", () => {
    const result = buildProviderOnboardingRecommendation({
      businessProfile: business,
      connections: [{
        label: "Local model", status: "active",
        facts: facts({
          providerId: "local",
          catalogProviderId: "local",
          externalEgress: "none",
          executionChannel: "local-runtime",
          authMethod: "local",
        }),
      }],
      handlesCardPayments: true,
    });

    expect(result.useNow).toEqual([expect.objectContaining({ scope: "company-work" })]);
    expect(result.caveat).toContain("Local processing reduces external egress");
    expect(result.caveat).toContain("does not by itself prove compliance");
  });

  it("does not recommend an unconfigured local connection for use now", () => {
    const result = buildProviderOnboardingRecommendation({
      businessProfile: business,
      connections: [{
        label: "Local model",
        status: "unconfigured",
        facts: facts({ providerId: "local", catalogProviderId: "local", externalEgress: "none", executionChannel: "local-runtime" }),
      }],
      handlesCardPayments: false,
    });
    expect(result.useNow).toEqual([]);
    expect(result.useAfterReview[0]?.reason).toContain("Connect and test");
  });

  it("derives regulated workloads from business archetype and payment context", () => {
    const result = buildProviderOnboardingRecommendation({
      businessProfile: { ...business, archetypeCategory: "healthcare" },
      connections: [],
      handlesCardPayments: true,
    });
    expect(result.workloadClasses).toEqual(expect.arrayContaining(["health-phi", "payments-finance", "customer-records"]));
  });
});
