import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { mockResolveAuth, mockRecord, mockAudit } = vi.hoisted(() => ({
  mockResolveAuth: vi.fn(),
  mockRecord: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mockResolveAuth }));
vi.mock("@/lib/federation/nearby-candidates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/federation/nearby-candidates")>()),
  recordNearbyFederationCandidates: mockRecord,
}));
vi.mock("@/lib/edge-node/audit", () => ({ writeEdgeNodeAudit: mockAudit }));
vi.mock("@/lib/app-url", () => ({ resolveAppBaseUrl: () => "https://local.dpf" }));

import { POST } from "./route";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edge-row-1",
  nodeId: "edge-node-1",
  trustState: "trusted" as const,
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    observedAt: new Date().toISOString(),
    candidates: [
      {
        discoveryId: "yM4sS9VcH0rW2nQ8",
        endpoint: "https://192.168.1.42",
        protocol: "1",
        capabilityDigest: "8f31c9a2",
        pairPath: "/connect/pair",
      },
    ],
    ...overrides,
  };
}

function request(payload: unknown): NextRequest {
  return new Request("http://test/api/v1/edge/federation-candidates", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer dpfedge_test" },
    body: JSON.stringify(payload),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockResolveAuth.mockResolvedValue(AUTHED);
});

describe("POST /api/v1/edge/federation-candidates", () => {
  it("requires the existing trusted discovery submission scope", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      error: "scope_disallowed",
      message: "scope disallowed",
    });

    const response = await POST(request(body()));

    expect(response.status).toBe(403);
    expect(mockResolveAuth).toHaveBeenCalledWith("Bearer dpfedge_test", "discovery:submit");
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects unknown TXT-derived fields at the Authority boundary", async () => {
    const payload = body();
    (payload.candidates[0] as Record<string, unknown>).organization = "Private Company";

    const response = await POST(request(payload));

    expect(response.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects public Internet endpoints from link-local discovery", async () => {
    const payload = body();
    payload.candidates[0]!.endpoint = "https://example.com";

    const response = await POST(request(payload));

    expect(response.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("records a bounded candidate snapshot without creating trust", async () => {
    const payload = body();

    const response = await POST(request(payload));

    expect(response.status).toBe(202);
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        edgeNodeId: "edge-row-1",
        localAuthorityUrl: "https://local.dpf",
        candidates: payload.candidates,
      }),
    );
  });
});
