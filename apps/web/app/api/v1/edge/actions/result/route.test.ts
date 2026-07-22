import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveToken, mockResolveMtls, mockRecordResult } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockResolveMtls: vi.fn(),
  mockRecordResult: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mockResolveToken }));
vi.mock("@/lib/auth/edge-node-mtls", () => ({ resolveEdgeNodeMtls: mockResolveMtls }));
vi.mock("@/lib/auth/edge-mtls-proxy-secret", () => ({
  loadEdgeMtlsProxySecret: () => "proxy-secret-with-at-least-32-bytes",
}));
vi.mock("@/lib/remote-action/dispatch-orchestrator", () => ({ recordActionResult: mockRecordResult }));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new Request("http://test/api/v1/edge/actions/result", {
    method: "POST",
    headers: { authorization: "Bearer dpfedge_test", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true";
  mockResolveToken.mockResolvedValue({ ok: true, edgeNodeRowId: "edge-row-1" });
  mockResolveMtls.mockResolvedValue({ ok: true, certificateId: "cert-1" });
  mockRecordResult.mockResolvedValue({ ok: true, status: "succeeded" });
});

describe("POST /api/v1/edge/actions/result", () => {
  it("requires the machine-bound certificate before accepting a result", async () => {
    mockResolveMtls.mockResolvedValue({ ok: false, error: "certificate_unknown" });

    const response = await POST(request({ actionKey: "ra-1", outcome: "succeeded" }));

    expect(response.status).toBe(401);
    expect(mockRecordResult).not.toHaveBeenCalled();
  });

  it("passes a structured issue result separately from redacted evidence", async () => {
    const response = await POST(request({
      actionKey: "ra-1",
      outcome: "succeeded",
      evidence: { certificateTrust: true },
      result: { joinPackage: "DPF_ORGANIZATION_JOIN_V2\n..." },
    }));

    expect(response.status).toBe(200);
    expect(mockRecordResult).toHaveBeenCalledWith(expect.anything(), {
      actionKey: "ra-1",
      edgeNodeRowId: "edge-row-1",
      outcome: "succeeded",
      evidence: { certificateTrust: true },
      result: { joinPackage: "DPF_ORGANIZATION_JOIN_V2\n..." },
    });
  });

  it("does not treat arrays as an action result object", async () => {
    await POST(request({ actionKey: "ra-1", outcome: "failed", result: ["not", "an", "object"] }));

    expect(mockRecordResult).toHaveBeenCalledWith(expect.anything(), {
      actionKey: "ra-1",
      edgeNodeRowId: "edge-row-1",
      outcome: "failed",
    });
  });

  it("rejects an oversized body even when content-length is absent or under-declared", async () => {
    const oversized = request({
      actionKey: "ra-1",
      outcome: "succeeded",
      result: { joinPackage: "x".repeat(97 * 1024) },
    });
    oversized.headers.delete("content-length");

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(mockRecordResult).not.toHaveBeenCalled();
  });
});
