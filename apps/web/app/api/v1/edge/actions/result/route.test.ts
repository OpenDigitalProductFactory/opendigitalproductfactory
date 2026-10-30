import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveToken, mockResolveMtls, mockRecordResult, mockSettleQualification, findAction, findDrain, findConfig, completeSwap, failSwap, driveChange } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockResolveMtls: vi.fn(),
  mockRecordResult: vi.fn(),
  mockSettleQualification: vi.fn(),
  findAction:vi.fn(), findDrain:vi.fn(), findConfig:vi.fn(),completeSwap:vi.fn(),failSwap:vi.fn(),driveChange:vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mockResolveToken }));
vi.mock("@/lib/auth/edge-node-mtls", () => ({ resolveEdgeNodeMtls: mockResolveMtls }));
vi.mock("@/lib/auth/edge-mtls-proxy-secret", () => ({
  loadEdgeMtlsProxySecret: () => "proxy-secret-with-at-least-32-bytes",
}));
vi.mock("@/lib/remote-action/dispatch-orchestrator", () => ({ recordActionResult: mockRecordResult }));
vi.mock("@/lib/remote-action/qualification-windows-result", () => ({
  settleQualificationWindowsResult: mockSettleQualification,
}));
vi.mock("@dpf/db", () => ({ prisma: { remoteAction:{findUnique:findAction},quiescenceRun:{findUnique:findDrain},platformConfig:{findUnique:findConfig} } }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ signalSwapComplete:completeSwap,failQuiescenceSwap:failSwap }));
vi.mock("@/lib/change-management/register-change", () => ({ driveChangeThrough:driveChange }));

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
  mockSettleQualification.mockResolvedValue(true);
  findAction.mockResolvedValue(null); completeSwap.mockResolvedValue(undefined);failSwap.mockResolvedValue(undefined);driveChange.mockResolvedValue(undefined);
});

describe("POST /api/v1/edge/actions/result", () => {
  it("keeps an unknown native outcome paused, and closes only its own positively restored operation", async () => {
    const binding={ownerSessionId:"session",branchName:"codex/native",ownerPid:10,ownerProcessIdentity:"mac:10",quiescenceRunId:"QR-native",controllerManifestSha256:"a".repeat(64),providerDigest:"b".repeat(64)};
    const action={actionType:"inference.runtime.transition",actionKey:"RA-native",edgeNodeId:"edge-row-1",changeRequestId:"change-1",evidence:{nativeAdmission:binding,nativeStatus:"uncertain",settlement:"unknown"}};
    findAction.mockResolvedValue(action);
    await POST(request({actionKey:"RA-native",outcome:"failed",evidence:{settlement:"unknown"}}));
    expect(completeSwap).not.toHaveBeenCalled();expect(failSwap).not.toHaveBeenCalled();
    action.evidence.nativeStatus="failed-restored";action.evidence.settlement="confirmed";
    findDrain.mockResolvedValue({runId:"QR-native",trigger:"manual",triggerRefId:"inference-runtime:RA-native",status:"ready-to-swap"});
    findConfig.mockResolvedValue({value:{level:"draining",runId:"QR-native"}});
    await POST(request({actionKey:"RA-native",outcome:"failed",evidence:{settlement:"confirmed",nativeStatus:"failed-restored"}}));
    expect(failSwap).toHaveBeenCalledWith("QR-native",expect.any(String));
    expect(completeSwap).not.toHaveBeenCalled();
  });
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
