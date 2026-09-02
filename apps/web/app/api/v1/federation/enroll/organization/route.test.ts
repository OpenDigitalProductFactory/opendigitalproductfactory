import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockAccept, mockSelfUrl, mockEstate } = vi.hoisted(() => ({
  mockAccept: vi.fn(),
  mockSelfUrl: vi.fn(),
  mockEstate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: { platformConfig: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("@/lib/federation/organization-membership", () => ({ acceptOrganizationEnrolment: mockAccept }));
vi.mock("@/lib/federation/self-authority", () => ({ resolveLocalFederationAuthorityUrl: mockSelfUrl }));
vi.mock("@/lib/install/estate-identity", () => ({ loadEstateNameResolution: mockEstate }));

import { POST } from "./route";

function request(body: unknown = { statement: {}, signature: "x", certificateChain: [] }): NextRequest {
  return new Request("http://test/api/v1/federation/enroll/organization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSelfUrl.mockResolvedValue("http://192.168.0.152:3000");
  mockEstate.mockResolvedValue({ estateName: "Production", tier: "portal" });
  mockAccept.mockResolvedValue({ accepted: true, linkId: "link_new", linkToken: "dpflink_new", proof: null });
});

describe("POST /api/v1/federation/enroll/organization", () => {
  it("creates a trusted link from a verified proof and returns the token plus our proof", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ linkId: "link_new", linkToken: "dpflink_new", linkState: "trusted", role: "same-org-peer" });
    expect(mockAccept).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ localAuthorityUrl: "http://192.168.0.152:3000", displayName: "Production" }));
  });

  it("refuses a bad proof with the reason and never needs a bearer token", async () => {
    mockAccept.mockResolvedValue({ accepted: false, status: 403, reason: "chain:issuer-mismatch" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MEMBERSHIP_PROOF_REFUSED" });
    mockAccept.mockResolvedValue({ accepted: false, status: 404, reason: "organization-trust-not-configured" });
    expect((await POST(request())).status).toBe(404);
  });

  it("rejects non-JSON and an install that cannot name its own address", async () => {
    expect((await POST(request("not json"))).status).toBe(400);
    mockSelfUrl.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mockAccept).not.toHaveBeenCalled();
  });
});
