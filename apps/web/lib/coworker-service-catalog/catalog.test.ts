import { describe, expect, it } from "vitest";

import { buildCoworkerCatalog, filterCoworkerOffers } from "./catalog";

const baseRows = {
  services: [
    {
      serviceId: "svc-legal-packets",
      providerAgentId: "legal-operations-counsel",
      name: "Prepare attorney-review packet",
      summary: "Assemble facts, sources, draft issues, and counsel questions.",
      description: "Legal operations review-packet preparation.",
      status: "active",
      riskTier: "high",
      hitlTier: 1,
      authorityBoundary: "proposal-only",
      availabilityScope: "internal",
      personas: ["founder", "operator"],
      portfolioRoles: ["foundational"],
      valueStreams: ["consume", "operate"],
      archetypes: ["software-and-platforms", "professional-services"],
      jurisdictions: ["us", "global"],
      requiredInputs: [{ key: "document", label: "Document or draft" }],
      producedOutputs: [{ key: "review-packet", label: "Attorney-review packet" }],
      backingSkillIds: ["prepare-counsel-packet"],
      backingToolNames: ["doc_save", "doc_search"],
      backingGrantKeys: ["document_write", "registry_read"],
      costModel: { unit: "packet", estimate: "internal-budget" },
      contractTerms: { posture: "attorney-review-required" },
      dataBoundary: { sensitivity: "confidential", retention: "managed-document" },
      metadata: { legalRisk: "attorney-review-required" },
      digitalProductId: "dpf-platform",
      serviceOfferingId: null,
      createdAt: new Date("2026-06-30T00:00:00Z"),
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    },
  ],
  offers: [
    {
      offerId: "offer-arcamanus-legal-packet",
      serviceId: "svc-legal-packets",
      name: "Arcamanus/DPF legal packet review",
      summary: "Prepare Arcamanus operating terms for attorney review.",
      description: "Internal high-risk legal packet offer.",
      status: "active",
      version: "1.0.0",
      providerOrganization: "Arcamanus",
      availabilityScope: "internal",
      riskTier: "high",
      authorityBoundary: "proposal-only",
      eligibleConsumers: ["founder", "operator"],
      budgetEnvelope: { estimate: "TBD", approval: "operator" },
      sla: { turnaround: "2 business days" },
      requiredApprovals: [{ type: "attorney-review", required: true }],
      legalTerms: { termsRequired: true },
      dataBoundary: { sensitivity: "confidential" },
      deliverables: ["Counsel packet", "Question list", "Source coverage notes"],
      filters: { artifact: "legal-review-packet", jurisdiction: ["us", "global"] },
      metadata: { legalRisk: "attorney-review-required" },
      expiresAt: null,
      digitalProductId: "dpf-platform",
      createdAt: new Date("2026-06-30T00:00:00Z"),
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    },
  ],
  agents: [
    {
      agentId: "legal-operations-counsel",
      displayName: "Legal Operations Counsel",
      name: "legal-operations-counsel",
      kind: "specialist",
      valueStream: "cross-cutting",
      portfolio: { slug: "foundation", name: "Foundation" },
      hitlTierDefault: 1,
      sensitivity: "confidential",
      toolGrants: [{ grantKey: "document_write" }, { grantKey: "registry_read" }],
    },
  ],
  skills: [
    {
      agentId: "legal-operations-counsel",
      skillId: "prepare-counsel-packet",
      enabled: true,
      skill: {
        skillId: "prepare-counsel-packet",
        name: "Prepare counsel packet",
        riskBand: "high",
        allowedTools: ["doc_save", "doc_search"],
      },
    },
  ],
  digitalProducts: [
    {
      productId: "dpf-platform",
      name: "Digital Product Factory",
      portfolio: { slug: "foundation", name: "Foundation" },
    },
  ],
};

describe("buildCoworkerCatalog", () => {
  it("keeps service capability, packaged offer, and provider identity separate", () => {
    const catalog = buildCoworkerCatalog(baseRows);

    expect(catalog.services).toHaveLength(1);
    expect(catalog.offers).toHaveLength(1);
    expect(catalog.services[0]).toMatchObject({
      serviceId: "svc-legal-packets",
      provider: { agentId: "legal-operations-counsel", displayName: "Legal Operations Counsel" },
      authorityBoundary: "proposal-only",
      backing: {
        skillIds: ["prepare-counsel-packet"],
        toolNames: ["doc_save", "doc_search"],
        grantKeys: ["document_write", "registry_read"],
      },
    });
    expect(catalog.offers[0]).toMatchObject({
      offerId: "offer-arcamanus-legal-packet",
      serviceId: "svc-legal-packets",
      serviceName: "Prepare attorney-review packet",
      provider: { displayName: "Legal Operations Counsel" },
      digitalProduct: { productId: "dpf-platform", name: "Digital Product Factory" },
    });
  });

  it("surfaces Legal Operations Counsel offers only when the coworker exists", () => {
    expect(buildCoworkerCatalog(baseRows).offers.map((offer) => offer.provider.displayName)).toContain(
      "Legal Operations Counsel",
    );

    expect(buildCoworkerCatalog({ ...baseRows, agents: [] }).offers).toEqual([]);
  });
});

describe("filterCoworkerOffers", () => {
  it("filters by persona, jurisdiction, risk, availability, value stream, and artifact", () => {
    const catalog = buildCoworkerCatalog(baseRows);

    expect(
      filterCoworkerOffers(catalog.offers, {
        persona: "founder",
        jurisdiction: "us",
        riskTier: "high",
        availabilityScope: "internal",
        valueStream: "operate",
        artifact: "legal-review-packet",
      }).map((offer) => offer.offerId),
    ).toEqual(["offer-arcamanus-legal-packet"]);

    expect(filterCoworkerOffers(catalog.offers, { jurisdiction: "eu" })).toEqual([]);
  });

  it("keeps archetype filtering exact without wildcard, empty-list, or category expansion", () => {
    const catalog = buildCoworkerCatalog(baseRows);

    expect(filterCoworkerOffers(catalog.offers, { archetype: "professional-services" })).toHaveLength(1);
    expect(filterCoworkerOffers(catalog.offers, { archetype: "legal-services" })).toEqual([]);

    const wildcardCatalog = buildCoworkerCatalog({
      ...baseRows,
      services: [{ ...baseRows.services[0], archetypes: ["*"] }],
    });
    expect(filterCoworkerOffers(wildcardCatalog.offers, { archetype: "professional-services" })).toEqual([]);

    const emptyCatalog = buildCoworkerCatalog({
      ...baseRows,
      services: [{ ...baseRows.services[0], archetypes: [] }],
    });
    expect(filterCoworkerOffers(emptyCatalog.offers, { archetype: "professional-services" })).toEqual([]);
  });
});
