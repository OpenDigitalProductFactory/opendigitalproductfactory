import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockResolveIdentity, mockLoadUsage } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockResolveIdentity: vi.fn(),
  mockLoadUsage: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth/federation-link-token", () => ({ resolveFederationLinkAuth: mockResolveAuth }));
vi.mock("@/lib/federation/demand-identity", () => ({ resolveFederationIdentity: mockResolveIdentity }));
vi.mock("@/lib/finance/subscription-cost-estimator.server", () => ({ loadLocalHourlyAiUsage: mockLoadUsage }));

import { GET } from "./route";

function request(): NextRequest {
  return new Request("http://test/api/v1/federation/ai-usage", {
    method: "GET",
    headers: { authorization: "Bearer dpflink_test" },
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveIdentity.mockResolvedValue({ installationId: "inst_prod", projectionSecret: "s" });
  mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "same-org-peer" });
  mockLoadUsage.mockResolvedValue({
    usage: [{ providerId: "chatgpt", hour: 490000, inputTokens: 10, outputTokens: 2 }],
    hits: [{ providerId: "chatgpt", hour: 490000, hits: 1 }],
  });
});

describe("GET /api/v1/federation/ai-usage", () => {
  it("serves this installation's own hourly usage to a same-organization peer", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      specVersion: "dpf.ai-usage.v1", originInstallationId: "inst_prod", lookbackDays: 30, rows: [["chatgpt", 490000, 10, 2, 1]],
    });
  });

  it("requires a trusted link", async () => {
    mockResolveAuth.mockResolvedValue({ ok: false, error: "link_not_trusted", message: "not trusted" });
    expect((await GET(request())).status).toBe(403);
    expect(mockLoadUsage).not.toHaveBeenCalled();
  });

  it("serves only a same-organization peer", async () => {
    mockResolveAuth.mockResolvedValue({ ok: true, linkId: "link_1", role: "managed-by" });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "LINK_NOT_SAME_ORGANIZATION" });
    expect(mockLoadUsage).not.toHaveBeenCalled();
  });
});
