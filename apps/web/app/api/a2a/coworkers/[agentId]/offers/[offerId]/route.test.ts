import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const { mockAuth, mockLoadCoworkerCatalog } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockLoadCoworkerCatalog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/coworker-service-catalog/catalog", () => ({
  loadCoworkerCatalog: mockLoadCoworkerCatalog,
}));

function catalogOffer(overrides: Record<string, unknown> = {}) {
  const provider = {
    agentId: "sales-coworker",
    displayName: "Sales AI Coworker",
    kind: "specialist",
    valueStream: "consume",
    hitlTierDefault: 1,
    sensitivity: "external",
    portfolio: null,
  };
  const service = {
    serviceId: "svc-sales",
    name: "Sales qualification",
    summary: "Qualify external sales requests.",
    description: null,
    status: "active",
    riskTier: "medium",
    hitlTier: 1,
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["customer"],
    portfolioRoles: ["commercial"],
    valueStreams: ["consume"],
    archetypes: [],
    jurisdictions: [],
    requiredInputs: [{ key: "inquiry" }],
    producedOutputs: [{ key: "qualification" }],
    costModel: {},
    contractTerms: {},
    dataBoundary: {},
    metadata: {},
    provider,
    backing: { skillIds: ["qualify-sales-request"], toolNames: [], grantKeys: ["registry_read"] },
    digitalProduct: null,
    serviceOfferingId: null,
  };
  return {
    offerId: "offer-sales",
    serviceId: "svc-sales",
    serviceName: "Sales qualification",
    name: "External sales qualification",
    summary: "Qualify an external customer inquiry.",
    description: null,
    status: "active",
    version: "1.0.0",
    providerOrganization: "DPF",
    availabilityScope: "external",
    riskTier: "medium",
    authorityBoundary: "proposal-only",
    eligibleConsumers: ["customer"],
    budgetEnvelope: {},
    sla: {},
    requiredApprovals: [],
    legalTerms: { termsRef: "terms://sales" },
    dataBoundary: { classification: "partner-visible" },
    deliverables: ["qualification"],
    filters: {},
    metadata: { gaid: "gaid:public:sales", aidocRef: "aidoc://sales/public" },
    expiresAt: null,
    provider,
    service,
    digitalProduct: null,
    ...overrides,
  };
}

describe("A2A coworker offer route", () => {
  it("requires authentication for internal offer cards", async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCoworkerCatalog.mockResolvedValue({
      services: [],
      offers: [catalogOffer({ availabilityScope: "internal", metadata: { gaid: "gaid:private:sales", aidocRef: "aidoc://sales/private" } })],
    });

    const response = await GET(new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales"), {
      params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }),
    });

    expect(response.status).toBe(401);
  });

  it("returns an external Agent Card when cross-boundary metadata is complete", async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });

    const response = await GET(new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales"), {
      params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/agent-card+json");
    await expect(response.json()).resolves.toMatchObject({
      agentId: "sales-coworker",
      offerId: "offer-sales",
      exposure: "public",
      identity: { gaid: "gaid:public:sales", aidocRef: "aidoc://sales/public" },
    });
  });
});
