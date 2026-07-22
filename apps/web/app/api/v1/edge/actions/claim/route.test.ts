import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveToken, mockResolveMtls, mockClaim, mockLoadSigner, mockFindCapability } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockResolveMtls: vi.fn(),
  mockClaim: vi.fn(),
  mockLoadSigner: vi.fn(),
  mockFindCapability: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mockResolveToken }));
vi.mock("@/lib/auth/edge-node-mtls", () => ({ resolveEdgeNodeMtls: mockResolveMtls }));
vi.mock("@/lib/remote-action/dispatch-orchestrator", () => ({ claimActionsForNode: mockClaim }));
vi.mock("@/lib/remote-action/action-signing-key", () => ({ loadEdgeActionSigner: mockLoadSigner }));
vi.mock("@dpf/db", () => ({ prisma: { edgeNodeCapability: { findFirst: mockFindCapability } } }));

import { POST } from "./route";

const AUTHED = {
  ok: true as const,
  edgeNodeRowId: "edge-row-1",
  nodeId: "edge-external-1",
  trustState: "trusted" as const,
  customerAccountId: null,
  customerSiteId: null,
  scopePolicy: { actionTypes: ["inventory.collect"] },
};

function request(): NextRequest {
  return new Request("http://test/api/v1/edge/actions/claim", {
    method: "POST",
    headers: {
      authorization: "Bearer dpfedge_test",
      "content-type": "application/json",
      "x-dpf-mtls-proxy-secret": "proxy",
      "x-dpf-edge-cert-fingerprint": "a".repeat(64),
    },
    body: "{}",
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true";
  process.env.DPF_EDGE_MTLS_PROXY_SECRET = "proxy-secret-with-at-least-32-bytes";
  mockResolveToken.mockResolvedValue(AUTHED);
  mockResolveMtls.mockResolvedValue({ ok: true, certificateId: "cert-1", fingerprintSha256: "a".repeat(64) });
  mockFindCapability.mockResolvedValue({ id: "cap-1" });
  mockLoadSigner.mockReturnValue({ signingKeyId: "key-1", sign: vi.fn() });
  mockClaim.mockResolvedValue({ claimed: [], skipped: 0 });
});

describe("POST /api/v1/edge/actions/claim", () => {
  it("requires both bearer auth and an active machine-bound mTLS certificate", async () => {
    mockResolveMtls.mockResolvedValue({ ok: false, error: "certificate_unknown" });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("passes the explicit per-node action allowlist and signer to the orchestrator", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mockResolveMtls).toHaveBeenCalledWith(
      expect.any(Headers),
      "edge-row-1",
      expect.anything(),
      expect.objectContaining({ proxySecret: "proxy-secret-with-at-least-32-bytes" }),
    );
    expect(mockClaim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        edgeNodeId: "edge-row-1",
        nodeId: "edge-external-1",
        allowedActionTypes: ["inventory.collect"],
      }),
      expect.objectContaining({ signer: expect.objectContaining({ signingKeyId: "key-1" }) }),
    );
  });

  it("defaults to an empty allowlist when scope policy is absent", async () => {
    mockResolveToken.mockResolvedValue({ ...AUTHED, scopePolicy: null });
    await POST(request());
    expect(mockClaim.mock.calls[0]![1].allowedActionTypes).toEqual([]);
  });
});
