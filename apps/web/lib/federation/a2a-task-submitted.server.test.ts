import { describe, expect, it, vi } from "vitest";

import type { A2aRequestV1 } from "@dpf/db/federated-a2a-contract";

vi.mock("@/lib/coworker-service-catalog/a2a-tasks", () => ({ createCoworkerA2aTask: vi.fn(), readCoworkerA2aTask: vi.fn() }));
vi.mock("@/lib/coworker-service-catalog/catalog", () => ({ loadCoworkerCatalog: vi.fn() }));
vi.mock("@/lib/coworker-service-catalog/engagements", () => ({ createCoworkerEngagement: vi.fn() }));
vi.mock("@/lib/coworker-service-catalog/agent-card", () => ({
  projectCoworkerOfferAgentCard: vi.fn((offer: { availabilityScope: string }) => offer.availabilityScope === "internal"
    ? { ok: false, reason: "offer_not_available_for_access_profile", missing: [] }
    : {
      ok: true,
      card: {
        agentId: "sales-coworker",
        serviceId: "svc-sales",
        identity: { gaid: "gaid:public:sales" },
        authorityBoundary: "proposal-only",
        riskTier: "medium",
        security: { requiredGrants: ["registry_read"] },
      },
    }),
}));

import { peerEngagementId, taskSubmittedHandler } from "./a2a-task-submitted.server";

function request(payload: Record<string, unknown> = {}, acting: string | null = "gaid:priv:dpf.internal:agt-a"): A2aRequestV1 {
  return {
    specVersion: "dpf.a2a-request/1",
    requestId: "a2r_01JZ0000000000000000000001",
    operation: "task.submitted",
    createdAt: "2026-11-14T11:59:00.000Z",
    notAfter: "2026-11-17T11:59:00.000Z",
    sourceInstallationDid: `did_${"a".repeat(64)}`,
    sourceSigningPublicKey: "k",
    targetInstallationDid: `did_${"b".repeat(64)}`,
    organizationRef: "org-1",
    requesterEnvironmentClass: "production",
    senderTaskId: "TR-sender-1",
    contextId: "ctx-1",
    provenance: { actingAgentGaid: acting, delegatingAgentGaid: null },
    payload: {
      offerId: "offer-sales",
      requestedOutcome: "Qualify this buyer.",
      contractContext: { termsRef: "terms://sales", dataBoundaryRef: "boundary://sales" },
      ...payload,
    },
    signature: "h.p.s",
  };
}

function deps(scope = "partner") {
  const createTask = vi.fn(async (input: Record<string, unknown>, d: { createEngagement: (i: unknown) => unknown }) => {
    await d.createEngagement({ offerId: input.offerId });
    return { id: "CE-A2A-X", status: { state: "submitted" } };
  });
  const createEngagement = vi.fn(async (_input: unknown, _deps: { db: unknown; idFactory: () => string }) => ({}));
  return {
    loadCatalog: vi.fn(async () => ({ services: [], offers: [{ offerId: "offer-sales", availabilityScope: scope }] })),
    createTask,
    createEngagement,
  } as never as { loadCatalog: ReturnType<typeof vi.fn>; createTask: typeof createTask; createEngagement: typeof createEngagement };
}

const ctx = { linkId: "link-1", tx: { tx: true } as never, now: new Date() };

describe("task.submitted handler (BI-B45BBD8A)", () => {
  it("creates the receiver-owned task through the A2A task service, on the inbox transaction, with a stable id", async () => {
    const d = deps();
    const result = await taskSubmittedHandler(d as never).start(request(), ctx);

    expect(result).toEqual({ started: true, receiverTaskId: "CE-A2A-X", state: "submitted" });
    expect(d.createTask).toHaveBeenCalledWith(expect.objectContaining({
      offerId: "offer-sales",
      accessProfile: "partner-a2a",
      actingAgentGaid: "gaid:priv:dpf.internal:agt-a",
      delegatingAgentGaid: "gaid:priv:dpf.internal:agt-a",
      contextId: "ctx-1",
      submittingFederationLinkId: "link-1",
      peer: { requestId: "a2r_01JZ0000000000000000000001", senderTaskId: "TR-sender-1", sourceInstallationDid: `did_${"a".repeat(64)}` },
    }), expect.anything());
    const engagementDeps = d.createEngagement.mock.calls[0]![1];
    expect(engagementDeps.db).toEqual({ tx: true });
    expect(engagementDeps.idFactory()).toBe(peerEngagementId("link-1", "a2r_01JZ0000000000000000000001"));
  });

  it("the receiver task id is stable per link and request, and differs across links", () => {
    expect(peerEngagementId("link-1", "a2r_x")).toBe(peerEngagementId("link-1", "a2r_x"));
    expect(peerEngagementId("link-1", "a2r_x")).not.toBe(peerEngagementId("link-2", "a2r_x"));
  });

  it("a peer cannot reach an internal-only offer", async () => {
    const d = deps("internal");
    expect(await taskSubmittedHandler(d as never).start(request(), ctx)).toEqual({ started: false, reason: "target-unavailable" });
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("an unknown offer is target-unavailable", async () => {
    const d = deps();
    expect(await taskSubmittedHandler(d as never).start(request({ offerId: "nope" }), ctx)).toEqual({ started: false, reason: "target-unavailable" });
  });

  it("refuses a request with no acting GAID, or without terms and data boundary", async () => {
    const d = deps();
    expect(await taskSubmittedHandler(d as never).start(request({}, null), ctx)).toEqual({ started: false, reason: "not-authorized" });
    expect(await taskSubmittedHandler(d as never).start(request({ contractContext: {} }), ctx)).toEqual({ started: false, reason: "malformed" });
    expect(d.createTask).not.toHaveBeenCalled();
  });
});
