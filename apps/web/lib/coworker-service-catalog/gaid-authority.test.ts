import { describe, expect, it } from "vitest";

import { verifyCoworkerOfferGaidAuthority } from "./gaid-authority";
import type { CoworkerOfferCatalogItem } from "./catalog";

function offer(overrides: Partial<CoworkerOfferCatalogItem> = {}): CoworkerOfferCatalogItem {
  const provider = {
    agentId: "supplier-coworker",
    displayName: "Supplier AI Coworker",
    kind: "specialist",
    valueStream: "consume",
    hitlTierDefault: 1,
    sensitivity: "external",
    portfolio: null,
  };
  const service = {
    serviceId: "svc-supplier",
    name: "Supplier support",
    summary: "Support supplier requests.",
    description: null,
    status: "active",
    riskTier: "medium",
    hitlTier: 1,
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["supplier"],
    portfolioRoles: ["commercial"],
    valueStreams: ["consume"],
    archetypes: [],
    jurisdictions: [],
    requiredInputs: [],
    producedOutputs: [],
    costModel: {},
    contractTerms: {},
    dataBoundary: {},
    metadata: {},
    portfolio: null,
    provider,
    backing: { skillIds: ["supplier-support"], toolNames: [], grantKeys: ["registry_read"] },
    digitalProduct: null,
    serviceOfferingId: null,
  } satisfies CoworkerOfferCatalogItem["service"];
  return {
    offerId: "offer-supplier",
    serviceId: "svc-supplier",
    serviceName: service.name,
    name: "External supplier support",
    summary: "Support an external supplier.",
    description: null,
    status: "active",
    version: "1.0.0",
    providerOrganization: "DPF",
    availabilityScope: "external",
    riskTier: "medium",
    authorityBoundary: "proposal-only",
    eligibleConsumers: ["supplier"],
    budgetEnvelope: {},
    sla: {},
    requiredApprovals: [],
    legalTerms: { termsRef: "terms://supplier" },
    dataBoundary: { classification: "external" },
    deliverables: ["response"],
    filters: {},
    metadata: {},
    expiresAt: null,
    provider,
    service,
    digitalProduct: null,
    ...overrides,
  };
}

describe("verifyCoworkerOfferGaidAuthority", () => {
  it("requires verified cross-boundary GAID authority metadata for external offers", () => {
    const result = verifyCoworkerOfferGaidAuthority(offer(), { accessProfile: "external-a2a" });

    expect(result).toEqual({
      ok: false,
      reason: "gaid_authority_not_verified",
      missing: ["gaidAuthority"],
    });
  });

  it("accepts non-expired verified public authority metadata", () => {
    const result = verifyCoworkerOfferGaidAuthority(
      offer({
        metadata: {
          gaid: "gaid:public:supplier",
          aidocRef: "aidoc://supplier/public",
          gaidAuthority: {
            state: "verified",
            exposure: "public",
            subjectAgentId: "supplier-coworker",
            verifiedAt: "2026-06-01T00:00:00.000Z",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        },
      }),
      { accessProfile: "external-a2a", now: new Date("2026-06-30T00:00:00.000Z") },
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects partner authority metadata for public external exposure", () => {
    const result = verifyCoworkerOfferGaidAuthority(
      offer({
        metadata: {
          gaid: "gaid:partner:supplier",
          aidocRef: "aidoc://supplier/partner",
          gaidAuthority: {
            state: "verified",
            exposure: "partner",
            subjectAgentId: "supplier-coworker",
            verifiedAt: "2026-06-01T00:00:00.000Z",
          },
        },
      }),
      { accessProfile: "external-a2a" },
    );

    expect(result).toEqual({
      ok: false,
      reason: "gaid_authority_scope_mismatch",
      missing: ["gaidAuthority.exposure"],
    });
  });
});
