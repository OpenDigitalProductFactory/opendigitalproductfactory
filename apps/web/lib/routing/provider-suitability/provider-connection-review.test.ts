import { describe, expect, it } from "vitest";

import type { BusinessSuitabilityProfile, ProviderTrustFacts } from "./types";
import { projectProviderConnectionReview } from "./provider-connection-review";

const businessProfile = (dataResidency: string[] = []): BusinessSuitabilityProfile => ({
  organizationId: "org-1",
  archetypeId: "pet-rescue",
  archetypeCategory: "nonprofit-community",
  operatesIn: ["us"],
  sellsTo: [],
  employsIn: [],
  dataResidency,
  riskPosture: "balanced",
});

const facts = (overrides: Partial<ProviderTrustFacts> = {}): ProviderTrustFacts => ({
  providerId: "zai",
  catalogProviderId: "zai",
  category: "direct",
  jurisdictions: [],
  externalEgress: "provider-cloud",
  supportsZdr: null,
  supportsNoTraining: true,
  supportsRegionalRouting: true,
  supportedRegions: ["us"],
  regionalEndpoints: [],
  providerConnectionId: "provider-default-zai",
  executionChannel: "direct-api",
  accountClass: "enterprise",
  commercialBasis: "usage-metered",
  authMethod: "api-key",
  contractEvidence: {},
  entitlements: { noTraining: true },
  evidenceStatus: "operator-attested",
  lastReviewedAt: "2026-09-03T00:00:00.000Z",
  ...overrides,
});

describe("projectProviderConnectionReview", () => {
  it("does not turn a US locale into a region or DPA requirement", () => {
    const result = projectProviderConnectionReview({
      businessProfile: businessProfile(),
      businessContextConfigured: true,
      handlesCardPayments: false,
      facts: facts(),
    });
    expect(result.scope).toBe("company-work");
    expect(result.requiredRegions).toEqual([]);
    expect(result.requiredClaimKeys).not.toContain("enabled-regions");
    expect(result.requiredClaimKeys).not.toContain("dpa-on-file");
  });

  it("keeps public work explicit when canonical business context is missing", () => {
    const result = projectProviderConnectionReview({
      businessProfile: businessProfile(),
      businessContextConfigured: false,
      handlesCardPayments: false,
      facts: facts(),
    });
    expect(result.scope).toBe("public-only");
    expect(result.summary).toMatch(/business setup is incomplete/i);
  });

  it("requires the declared region from the account rather than inferring it from locale", () => {
    const result = projectProviderConnectionReview({
      businessProfile: businessProfile(["us"]),
      businessContextConfigured: true,
      handlesCardPayments: false,
      facts: facts(),
    });
    expect(result.scope).toBe("public-only");
    expect(result.requiredRegions).toEqual(["us"]);
    expect(result.requiredClaimKeys).toEqual(expect.arrayContaining(["regional-processing", "enabled-regions"]));
    expect(result.requiredClaimKeys).not.toContain("dpa-on-file");
  });

  it("maps source-code policy to account evidence without making DPA universal", () => {
    const result = projectProviderConnectionReview({
      businessProfile: { ...businessProfile(), archetypeCategory: "software" },
      businessContextConfigured: true,
      handlesCardPayments: false,
      facts: facts({ accountClass: "regular", entitlements: { noTraining: false } }),
    });
    expect(result.explanationCodes).toContain("business-account-unproven");
    expect(result.requiredClaimKeys).toContain("no-training");
    expect(result.requiredClaimKeys).not.toContain("dpa-on-file");
  });

  it("keeps bounded-router controls for non-public work", () => {
    const result = projectProviderConnectionReview({
      businessProfile: businessProfile(),
      businessContextConfigured: true,
      handlesCardPayments: false,
      facts: facts({
        providerId: "openrouter",
        catalogProviderId: "openrouter",
        category: "router",
        externalEgress: "router-cloud",
        executionChannel: "hosted-router",
        entitlements: { noTraining: true, zeroRetention: false },
        routerPassThrough: {
          exposesUnderlyingProvider: true,
          supportsProviderAllowlist: true,
          supportsProviderBlocklist: true,
          supportsZdrFilter: true,
          supportsDataCollectionDeny: true,
          supportsBoundedFallbacks: true,
        },
      }),
    });
    expect(result.explanationCodes).toContain("router-controls-unproven");
    expect(result.requiredClaimKeys).toEqual(expect.arrayContaining(["zero-retention", "approved-underlying-providers"]));
  });
});
