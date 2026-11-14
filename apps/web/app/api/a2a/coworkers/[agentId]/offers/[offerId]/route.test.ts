import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const { mockAuth, mockLoadCoworkerCatalog, mockCreateCoworkerA2aTask, mockResolveFederationLinkAuth } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockResolveFederationLinkAuth: vi.fn(),
  mockLoadCoworkerCatalog: vi.fn(),
  mockCreateCoworkerA2aTask: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveFederationLinkAuth }));
vi.mock("@/lib/coworker-service-catalog/catalog", () => ({
  loadCoworkerCatalog: mockLoadCoworkerCatalog,
}));
vi.mock("@/lib/coworker-service-catalog/a2a-tasks", () => ({
  createCoworkerA2aTask: mockCreateCoworkerA2aTask,
}));

const TRUSTED_LINK = {
  ok: true,
  linkId: "link-peer",
  role: "same-org-peer",
  linkState: "trusted",
  peerOrganizationRef: "org-1",
  projectionContractId: null,
  authorityBindingId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveFederationLinkAuth.mockResolvedValue({ ok: false, error: "missing_authorization", message: "Authorization header is required" });
});

const LINK_HEADERS = { authorization: "Bearer dpflink_peer" };

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
    metadata: {
      gaid: "gaid:public:sales",
      aidocRef: "aidoc://sales/public",
      gaidAuthority: {
        state: "verified",
        exposure: "public",
        subjectAgentId: "sales-coworker",
        verifiedAt: "2026-06-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    },
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

  it("submits an external A2A task for a selected offer", async () => {
    mockAuth.mockResolvedValue(null);
    mockResolveFederationLinkAuth.mockResolvedValue(TRUSTED_LINK);
    mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });
    mockCreateCoworkerA2aTask.mockResolvedValue({
      id: "CE-A2A",
      contextId: "ctx-1",
      status: { state: "submitted", timestamp: "2026-06-30T00:00:00.000Z" },
      providerAgentId: "sales-coworker",
      offerId: "offer-sales",
      serviceId: "svc-sales",
      messages: [],
      artifacts: [],
      metadata: {
        actingAgentGaid: "gaid:public:buyer",
        delegatingAgentGaid: "gaid:public:buyer",
        delegatedAgentId: "sales-coworker",
        approvalContext: {},
        delegationReceipt: { receiptKind: "coworker-delegation", receiptId: "CDR-1234" },
      },
    });

    const response = await POST(
      new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", {
        method: "POST",
        headers: LINK_HEADERS,
        body: JSON.stringify({
          requestedOutcome: "Qualify this buyer.",
          inputPayload: { inquiry: "Need enterprise pricing." },
          contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
          contextId: "ctx-1",
          actingAgentGaid: "gaid:public:buyer",
        }),
      }),
      { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
    );

    expect(response.status).toBe(202);
    expect(mockCreateCoworkerA2aTask).toHaveBeenCalledWith(
      expect.objectContaining({
        offerId: "offer-sales",
        requestedOutcome: "Qualify this buyer.",
        contextId: "ctx-1",
        actingAgentGaid: "gaid:public:buyer",
        delegatingAgentGaid: "gaid:public:buyer",
        delegatedAgentGaid: "gaid:public:sales",
        accessProfile: "external-a2a",
        authorityBoundary: "proposal-only",
        riskTier: "medium",
        requiredGrants: ["registry_read"],
        submittingFederationLinkId: "link-peer",
      }),
    );
    expect(mockResolveFederationLinkAuth).toHaveBeenCalledWith("Bearer dpflink_peer");
    await expect(response.json()).resolves.toMatchObject({ id: "CE-A2A", status: { state: "submitted" } });
  });

  it("rejects external A2A task submission without an acting GAID", async () => {
    mockAuth.mockResolvedValue(null);
    mockResolveFederationLinkAuth.mockResolvedValue(TRUSTED_LINK);
    mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });

    const response = await POST(
      new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", {
        method: "POST",
        body: JSON.stringify({
          requestedOutcome: "Qualify this buyer.",
          contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
        }),
      }),
      { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
    );

    expect(response.status).toBe(400);
    // Canonical apiErrorResponse envelope (BI-81EE4A46): { code, message, details }
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "Cross-boundary A2A task submission requires actingAgentGaid and delegatingAgentGaid.",
      details: { error: "missing_gaid_call_chain" },
    });
    expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
  });

  it("rejects external A2A task submission without terms and data-boundary context", async () => {
    mockAuth.mockResolvedValue(null);
    mockResolveFederationLinkAuth.mockResolvedValue(TRUSTED_LINK);
    mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });

    const response = await POST(
      new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", {
        method: "POST",
        body: JSON.stringify({
          requestedOutcome: "Qualify this buyer.",
          actingAgentGaid: "gaid:public:buyer",
          delegatingAgentGaid: "gaid:public:buyer",
        }),
      }),
      { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "Cross-boundary A2A task submission requires termsRef and dataBoundaryRef.",
      details: {
        error: "missing_contract_context",
        missing: ["termsRef", "dataBoundaryRef"],
      },
    });
    expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
  });

  // BI-D00C5FD4: a cross-boundary submission needs a verified credential.
  describe("credential on cross-boundary submission (BI-D00C5FD4)", () => {
    const externalBody = JSON.stringify({
      requestedOutcome: "Qualify this buyer.",
      contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
      actingAgentGaid: "gaid:public:buyer",
    });

    it("AC-1: an external submission with no credential is refused with 401 and creates nothing", async () => {
      mockAuth.mockResolvedValue(null);
      mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });

      const response = await POST(
        new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", { method: "POST", body: externalBody }),
        { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
      );

      expect(response.status).toBe(401);
      expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
    });

    it("AC-1: a partner submission with an unknown or untrusted link token is refused", async () => {
      mockAuth.mockResolvedValue(null);
      mockResolveFederationLinkAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "not trusted" });
      mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer({ availabilityScope: "partner" })] });

      const response = await POST(
        new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", { method: "POST", headers: LINK_HEADERS, body: externalBody }),
        { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
      );

      expect(response.status).toBe(403);
      expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
    });

    it("AC-1: a signed-in session alone is not a cross-boundary credential", async () => {
      mockAuth.mockResolvedValue({ user: { id: "u1" } });
      mockLoadCoworkerCatalog.mockResolvedValue({ services: [], offers: [catalogOffer()] });

      const response = await POST(
        new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales", { method: "POST", body: externalBody }),
        { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
      );

      expect(response.status).toBe(401);
      expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
    });

    it("AC-2: the query string cannot reach an internal offer through an external profile", async () => {
      mockAuth.mockResolvedValue(null);
      mockResolveFederationLinkAuth.mockResolvedValue(TRUSTED_LINK);
      mockLoadCoworkerCatalog.mockResolvedValue({
        services: [],
        offers: [catalogOffer({ availabilityScope: "internal" })],
      });

      const response = await POST(
        new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales?accessProfile=external-a2a", {
          method: "POST",
          headers: LINK_HEADERS,
          body: externalBody,
        }),
        { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
      );

      expect(response.status).toBe(403);
      expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
    });

    it("AC-2: without a session, the query string cannot downgrade an internal offer either", async () => {
      mockAuth.mockResolvedValue(null);
      mockLoadCoworkerCatalog.mockResolvedValue({
        services: [],
        offers: [catalogOffer({ availabilityScope: "internal" })],
      });

      const response = await POST(
        new Request("http://test/api/a2a/coworkers/sales-coworker/offers/offer-sales?accessProfile=partner-a2a", {
          method: "POST",
          body: externalBody,
        }),
        { params: Promise.resolve({ agentId: "sales-coworker", offerId: "offer-sales" }) },
      );

      expect([401, 403]).toContain(response.status);
      expect(mockCreateCoworkerA2aTask).not.toHaveBeenCalled();
    });
  });
});
