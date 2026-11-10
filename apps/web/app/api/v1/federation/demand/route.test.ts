import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockHandleIncomingDemand, mockHandleIncomingDemandResponse, mockHandleIncomingDisposition, mockHandleIncomingPosture, mockResolveIdentity } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockHandleIncomingDemand: vi.fn(),
  mockHandleIncomingDemandResponse: vi.fn(),
  mockHandleIncomingDisposition: vi.fn(),
  mockHandleIncomingPosture: vi.fn(),
  mockResolveIdentity: vi.fn(),
}));

vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveAuth }));
vi.mock("@/lib/federation/demand-exchange", () => ({ handleIncomingDemand: mockHandleIncomingDemand }));
vi.mock("@/lib/federation/demand-response", () => ({ handleIncomingDemandResponse: mockHandleIncomingDemandResponse }));
vi.mock("@/lib/federation/demand-identity", () => ({ resolveFederationIdentity: mockResolveIdentity }));
vi.mock("@/lib/federation/demand-disposition", () => ({ handleIncomingDemandDisposition: mockHandleIncomingDisposition }));
vi.mock("@/lib/federation/operational-posture-exchange", () => ({ handleIncomingOperationalPosture: mockHandleIncomingPosture }));

import { POST } from "./route";

const envelope = {
  specVersion: "dpf.demand/1",
  envelopeId: "dem_01",
  originInstallationId: "inst_origin",
  originRecordRef: "ref_01",
  originVersion: 1,
  route: [],
  audience: "internal",
  title: "Shared demand",
  summary: "Minimized summary",
  signal: { occurrenceCount: 1 },
  attribution: "organization",
  createdAt: "2026-07-20T05:00:00.000Z",
  updatedAt: "2026-07-20T05:00:00.000Z",
  payloadDigest: "sha256:v1",
};

function request(type = "dpf.demand.proposed", data: unknown = envelope): NextRequest {
  return new Request("http://test/api/v1/federation/demand", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer dpflink_test" },
    body: JSON.stringify({
      specversion: "1.0", id: "evt_1", source: "/dpf", type,
      time: new Date().toISOString(), datacontenttype: "application/json", dpflinkid: "link_1", data,
    }),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveIdentity.mockResolvedValue({ installationId: "inst_receiver", projectionSecret: "secret" });
  mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1" });
  mockHandleIncomingDemand.mockResolvedValue({
    action: "created",
    mirrorId: "fdm_1",
    originVersion: 1,
    disposition: "observed",
  });
  mockHandleIncomingDemandResponse.mockResolvedValue({ action: "created", responseId: "rsp_opaque" });
  mockHandleIncomingDisposition.mockResolvedValue({ action: "created", noticeId: "fdn_opaque" });
});

describe("POST /api/v1/federation/demand", () => {
  it("requires a trusted FederationLink", async () => {
    mockResolveAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "not trusted" });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mockHandleIncomingDemand).not.toHaveBeenCalled();
  });

  it("accepts only inbound demand lifecycle activities", async () => {
    const response = await POST(request("dpf.demand.adopted"));

    expect(response.status).toBe(422);
    expect(mockHandleIncomingDemand).not.toHaveBeenCalled();
  });

  it("persists a conforming envelope and returns its durable receipt identity", async () => {
    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: "created", mirrorId: "fdm_1" });
    expect(mockHandleIncomingDemand).toHaveBeenCalledWith(
      expect.anything(),
      "link_1",
      "dpf.demand.proposed",
      envelope,
      { receivingInstallationId: "inst_receiver" },
    );
  });

  it("routes collaboration responses to the durable response handler", async () => {
    const demandResponse = { specVersion: "dpf.demand-response/1", responseId: "rsp_opaque" };
    const response = await POST(request("dpf.demand.help-offered", demandResponse));

    expect(response.status).toBe(202);
    expect(mockHandleIncomingDemandResponse).toHaveBeenCalledWith(expect.anything(), "link_1", demandResponse);
    expect(mockHandleIncomingDemand).not.toHaveBeenCalled();
  });

  it("routes founder disposition notices over the same authenticated channel", async () => {
    const notice = { specVersion: "dpf.demand-disposition/1", noticeId: "fdn_opaque" };
    const response = await POST(request("dpf.demand.dispositioned", notice));

    expect(response.status).toBe(202);
    expect(mockHandleIncomingDisposition).toHaveBeenCalledWith(expect.anything(), "link_1", notice);
    expect(mockHandleIncomingDemand).not.toHaveBeenCalled();
  });

  it("returns validation violations without acknowledging receipt", async () => {
    mockHandleIncomingDemand.mockResolvedValue({ action: "rejected", violations: ["route:receiver-loop"] });

    const response = await POST(request());

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "invalid_demand_envelope" });
  });

  it("surfaces a non-advancing origin version as a conflict", async () => {
    mockHandleIncomingDemand.mockResolvedValue({
      action: "conflict",
      mirrorId: "fdm_1",
      originVersion: 3,
      reason: "origin-version-not-advancing",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
  });
});

describe("POST /api/v1/federation/inbox — operational posture (BI-648F01A0)", () => {
  const posture = { specVersion: "dpf.operational-posture/1", originInstallationId: "inst_origin", originVersion: 7 };

  it("routes a posture report from a same-organization peer to the posture handler", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "same-org-peer" });
    mockHandleIncomingPosture.mockResolvedValue({ action: "created", mirrorId: "fopm_1", originVersion: 7 });

    const response = await POST(request("dpf.operational-posture.reported", posture));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: "created", originVersion: 7 });
    expect(mockHandleIncomingPosture).toHaveBeenCalledWith(expect.anything(), "link_1", posture);
    expect(mockHandleIncomingDemand).not.toHaveBeenCalled();
  });

  it("refuses a posture report from a non-same-organization peer", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "managed-by" });

    const response = await POST(request("dpf.operational-posture.reported", posture));

    expect(response.status).toBe(403);
    expect(mockHandleIncomingPosture).not.toHaveBeenCalled();
  });

  it("maps rejected and conflict outcomes to 422 and 409", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "same-org-peer" });
    mockHandleIncomingPosture.mockResolvedValueOnce({ action: "rejected", violations: ["field:not-allowed:hostname"] });
    expect((await POST(request("dpf.operational-posture.reported", posture))).status).toBe(422);

    mockHandleIncomingPosture.mockResolvedValueOnce({ action: "conflict", mirrorId: "fopm_1", originVersion: 9, reason: "origin-version-not-advancing" });
    expect((await POST(request("dpf.operational-posture.reported", posture))).status).toBe(409);
  });
});
