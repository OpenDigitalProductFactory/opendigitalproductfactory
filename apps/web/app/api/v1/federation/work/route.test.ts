import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockResolveIdentity, mockBuildPage } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockResolveIdentity: vi.fn(),
  mockBuildPage: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveAuth }));
vi.mock("@/lib/federation/demand-identity", () => ({ resolveFederationIdentity: mockResolveIdentity }));
vi.mock("@/lib/federation/work-page", () => ({ buildFederatedWorkPage: mockBuildPage }));

import { GET } from "./route";

function request(query = ""): NextRequest {
  return new Request(`http://test/api/v1/federation/work${query}`, {
    method: "GET",
    headers: { authorization: "Bearer dpflink_test" },
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveIdentity.mockResolvedValue({ installationId: `inst_${"e".repeat(32)}`, projectionSecret: "s" });
  mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "same-org-peer" });
  mockBuildPage.mockResolvedValue({ specVersion: "dpf.work-sync/1", items: [], epics: [], cursor: null, complete: true });
});

describe("GET /api/v1/federation/work", () => {
  it("needs no flag: a trusted link is the only switch (EP-ZERO-CONFIG-FEDERATION)", async () => {
    delete process.env.DPF_FEDERATION_EXCHANGE_ENABLED;
    expect((await GET(request())).status).toBe(200);
  });

  it("requires a trusted link", async () => {
    mockResolveAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "not trusted" });
    expect((await GET(request())).status).toBe(403);
    mockResolveAuth.mockResolvedValue({ ok: false, error: "token_not_found", message: "no" });
    expect((await GET(request())).status).toBe(401);
  });

  it("serves only a same-organization peer", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "managed-by" });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "LINK_NOT_SAME_ORGANIZATION" });
    expect(mockBuildPage).not.toHaveBeenCalled();
  });

  it("passes the cursor and a bounded limit through and stamps this installation as origin", async () => {
    const response = await GET(request("?cursor=BI-B&limit=9999"));
    expect(response.status).toBe(200);
    expect(mockBuildPage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      originInstallationId: `inst_${"e".repeat(32)}`, cursor: "BI-B", limit: 500,
    }));
    expect(mockBuildPage.mock.calls[0]![1].limit).toBe(500);
  });
});
