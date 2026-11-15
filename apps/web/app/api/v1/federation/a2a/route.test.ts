import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockHandle, mockIdentity } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHandle: vi.fn(),
  mockIdentity: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockAuth }));
vi.mock("@/lib/federation/a2a-ingress", () => ({ handleIncomingA2aRequest: mockHandle }));
vi.mock("@/lib/federation/a2a-task-submitted.server", () => ({ taskSubmittedHandler: () => ({}) }));
vi.mock("@/lib/federation/demand-identity", () => ({ resolveFederationIdentity: mockIdentity }));

import { POST } from "./route";

function event(type = "dpf.a2a.task.submitted.v1") {
  return {
    specversion: "1.0",
    id: "link-1:a2r_x",
    source: "/dpf",
    type,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: { requestId: "a2r_x" },
  };
}

function post(body: unknown, authorization = "Bearer dpflink_x") {
  return POST(new Request("http://test/api/v1/federation/a2a", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, linkId: "link-1", role: "same-org-peer" });
  mockIdentity.mockResolvedValue({ installationId: "inst_x", deviceId: `did_${"b".repeat(64)}` });
});

describe("POST /api/v1/federation/a2a (BI-B45BBD8A)", () => {
  it("refuses a missing or unknown link credential with 401 and handles nothing", async () => {
    mockAuth.mockResolvedValue({ ok: false, error: "token_not_found", message: "no" });
    expect((await post(event())).status).toBe(401);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("refuses an untrusted link with 403", async () => {
    mockAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "no" });
    expect((await post(event())).status).toBe(403);
  });

  it("refuses an activity the ingress does not carry", async () => {
    expect((await post(event("dpf.demand.proposed"))).status).toBe(422);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("passes the authenticated link and this installation's DID to the handler, and answers 202 on acceptance", async () => {
    mockHandle.mockResolvedValue({ specVersion: "dpf.a2a-receipt/1", requestId: "a2r_x", outcome: "accepted", receiverTaskId: "CE-1", state: "submitted" });
    const response = await post(event());

    expect(response.status).toBe(202);
    expect(mockHandle).toHaveBeenCalledWith(
      expect.anything(),
      { linkId: "link-1", activity: "dpf.a2a.task.submitted.v1", record: { requestId: "a2r_x" } },
      expect.objectContaining({ selfInstallationDid: `did_${"b".repeat(64)}` }),
      expect.objectContaining({ "task.submitted": expect.anything() }),
    );
  });

  it("answers a refusal as a 200 receipt, never 401/403, so the sender's link is not quarantined", async () => {
    mockHandle.mockResolvedValue({ specVersion: "dpf.a2a-receipt/1", requestId: "a2r_x", outcome: "rejected", reason: "bad-signature" });
    const response = await post(event());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ outcome: "rejected", reason: "bad-signature" });
  });

  it("answers a reused requestId with different content as 409", async () => {
    mockHandle.mockResolvedValue({ specVersion: "dpf.a2a-receipt/1", requestId: "a2r_x", outcome: "rejected", reason: "request-id-conflict" });
    expect((await post(event())).status).toBe(409);
  });
});
