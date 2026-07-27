import { describe, expect, it } from "vitest";

import { projectCoworkerOfferAgentCard } from "./agent-card";
import type { CoworkerOfferCatalogItem } from "./catalog";

function offer(overrides: Partial<CoworkerOfferCatalogItem> = {}): CoworkerOfferCatalogItem {
  const service = {
    serviceId: "svc-legal",
    name: "Legal review packet",
    summary: "Prepare legal review packets.",
    description: null,
    status: "active",
    riskTier: "high",
    hitlTier: 1,
    authorityBoundary: "proposal-only",
    availabilityScope: "internal",
    personas: ["operator"],
    portfolioRoles: ["platform"],
    valueStreams: ["integrate"],
    archetypes: ["software"],
    jurisdictions: ["us"],
    requiredInputs: [{ key: "draft" }],
    producedOutputs: [{ key: "packet" }],
    costModel: { band: "internal" },
    contractTerms: { posture: "internal" },
    dataBoundary: { sensitivity: "confidential" },
    metadata: { gaid: "gaid:private:legal", aidocRef: "aidoc://legal/private" },
    portfolio: { slug: "platform", name: "Platform" },
    provider: {
      agentId: "legal-operations-counsel",
      displayName: "Legal Operations Counsel",
      kind: "specialist",
      valueStream: "integrate",
      hitlTierDefault: 1,
      sensitivity: "confidential",
      portfolio: { slug: "platform", name: "Platform" },
    },
    backing: {
      skillIds: ["prepare-counsel-packet"],
      toolNames: ["doc_search"],
      grantKeys: ["registry_read"],
    },
    digitalProduct: null,
    serviceOfferingId: null,
  } satisfies CoworkerOfferCatalogItem["service"];

  return {
    offerId: "offer-legal",
    serviceId: service.serviceId,
    serviceName: service.name,
    name: "Legal packet",
    summary: "Prepare a legal packet.",
    description: null,
    status: "active",
    version: "1.0.0",
    providerOrganization: "DPF",
    availabilityScope: "internal",
    riskTier: "high",
    authorityBoundary: "proposal-only",
    eligibleConsumers: ["operator"],
    budgetEnvelope: { band: "internal" },
    sla: { turnaround: "2 business days" },
    requiredApprovals: [{ type: "legal" }],
    legalTerms: { posture: "internal" },
    dataBoundary: { sensitivity: "confidential" },
    deliverables: ["packet"],
    filters: {},
    metadata: { gaid: "gaid:private:legal", aidocRef: "aidoc://legal/private" },
    expiresAt: null,
    provider: service.provider,
    service,
    digitalProduct: null,
    ...overrides,
  };
}

describe("projectCoworkerOfferAgentCard", () => {
  it("projects internal offers into private A2A Agent Cards", () => {
    const card = projectCoworkerOfferAgentCard(offer(), { accessProfile: "internal-a2a" });

    expect(card.ok).toBe(true);
    if (!card.ok) throw new Error(card.reason);
    expect(card.card).toMatchObject({
      agentId: "legal-operations-counsel",
      offerId: "offer-legal",
      protocol: "a2a",
      exposure: "private",
      identity: { gaid: "gaid:private:legal", aidocRef: "aidoc://legal/private" },
      security: { audience: "trusted-internal" },
    });
    expect(card.card.skills).toEqual([{ id: "prepare-counsel-packet", name: "Legal packet" }]);
  });

  it("rejects external projection when GAID/AIDoc or terms metadata is missing", () => {
    const result = projectCoworkerOfferAgentCard(
      offer({
        availabilityScope: "external",
        metadata: {},
        legalTerms: {},
        dataBoundary: {},
      }),
      { accessProfile: "external-a2a" },
    );

    expect(result).toEqual({
      ok: false,
      reason: "cross_boundary_identity_or_terms_missing",
      missing: ["gaid", "aidocRef", "legalTerms", "dataBoundary"],
    });
  });

  it("rejects external projection when GAID authority is not verified", () => {
    const result = projectCoworkerOfferAgentCard(
      offer({
        availabilityScope: "external",
        metadata: { gaid: "gaid:public:legal", aidocRef: "aidoc://legal/public" },
        legalTerms: { termsRef: "terms://legal" },
        dataBoundary: { classification: "external" },
      }),
      { accessProfile: "external-a2a" },
    );

    expect(result).toEqual({
      ok: false,
      reason: "gaid_authority_not_verified",
      missing: ["gaidAuthority"],
    });
  });

  it("projects external offers only when cross-boundary GAID authority is verified", () => {
    const result = projectCoworkerOfferAgentCard(
      offer({
        availabilityScope: "external",
        metadata: {
          gaid: "gaid:public:legal",
          aidocRef: "aidoc://legal/public",
          gaidAuthority: {
            state: "verified",
            exposure: "public",
            subjectAgentId: "legal-operations-counsel",
            verifiedAt: "2026-06-01T00:00:00.000Z",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        },
        legalTerms: { termsRef: "terms://legal" },
        dataBoundary: { classification: "external" },
      }),
      { accessProfile: "external-a2a", now: new Date("2026-06-30T00:00:00.000Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.card.exposure).toBe("public");
    expect(result.card.delegationReceiptPolicy.requireGaidForCrossOrganization).toBe(true);
  });

  it("keeps internal-only offers out of partner and external projections", () => {
    const result = projectCoworkerOfferAgentCard(offer(), { accessProfile: "partner-a2a" });

    expect(result).toEqual({
      ok: false,
      reason: "offer_not_available_for_access_profile",
      missing: [],
    });
  });
});
