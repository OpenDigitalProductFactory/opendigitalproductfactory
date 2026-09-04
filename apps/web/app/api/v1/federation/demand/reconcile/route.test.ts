import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockCompare, mockBindPeerIdentity } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockCompare: vi.fn(),
  mockBindPeerIdentity: vi.fn(),
}));

vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveAuth }));
vi.mock("@/lib/federation/demand-digest", () => ({ compareIncomingDemandDigest: mockCompare }));
vi.mock("@/lib/federation/channel-demand", () => ({ bindPeerInstallationIdentity: mockBindPeerIdentity }));

import { POST } from "./route";

const digest = {
  specVersion: "dpf.demand-digest/1",
  originInstallationId: "inst_origin",
  generatedAt: "2026-07-20T06:00:00.000Z",
  records: [{ originRecordRef: "ref_1", originVersion: 1, payloadDigest: "sha256:one", withdrawn: false }],
};

function request(data: unknown = digest, type = "dpf.demand.reconcile"): NextRequest {
  return new Request("http://test/api/v1/federation/demand/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer dpflink_test" },
    body: JSON.stringify({
      specversion: "1.0", id: "evt_digest", source: "/dpf", type,
      time: new Date().toISOString(), datacontenttype: "application/json", dpflinkid: "link_1", data,
    }),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1" });
  mockCompare.mockResolvedValue({ checked: 1, needs: [{ originRecordRef: "ref_1", reason: "missing" }] });
  mockBindPeerIdentity.mockResolvedValue({ action: "bound", peerInstallationId: "inst_origin" });
});

describe("POST /api/v1/federation/demand/reconcile", () => {
  it("requires a trusted link and the dedicated control activity", async () => {
    mockResolveAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "not trusted" });
    expect((await POST(request())).status).toBe(403);

    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1" });
    expect((await POST(request(digest, "dpf.demand.updated"))).status).toBe(422);
    expect(mockCompare).not.toHaveBeenCalled();
  });

  it("returns the bounded repair list for a valid digest", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true, checked: 1, needs: [{ originRecordRef: "ref_1", reason: "missing" }],
    });
    expect(mockCompare).toHaveBeenCalledWith(expect.anything(), "link_1", digest);
    expect(mockBindPeerIdentity).toHaveBeenCalledWith(expect.anything(), "link_1", "inst_origin");
  });

  it("rejects a malformed or oversized inventory before querying mirrors", async () => {
    const response = await POST(request({ ...digest, records: "all" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_demand_digest" });
    expect(mockCompare).not.toHaveBeenCalled();
  });
});
