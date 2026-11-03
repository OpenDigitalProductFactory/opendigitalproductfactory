import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveToken, mockResolveMtls, mockRecordResult, remoteFindUnique,
  roomFindUnique, roomUpdate, activityCreate } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockResolveMtls: vi.fn(),
  mockRecordResult: vi.fn(),
  remoteFindUnique: vi.fn(),
  roomFindUnique: vi.fn(),
  roomUpdate: vi.fn(),
  activityCreate: vi.fn(),
}));

vi.mock("@/lib/auth/edge-node-token", () => ({ resolveEdgeNodeAuth: mockResolveToken }));
vi.mock("@/lib/auth/edge-node-mtls", () => ({ resolveEdgeNodeMtls: mockResolveMtls }));
vi.mock("@/lib/auth/edge-mtls-proxy-secret", () => ({
  loadEdgeMtlsProxySecret: () => "x",
}));
vi.mock("@/lib/remote-action/dispatch-orchestrator", () => ({ recordActionResult: mockRecordResult }));
vi.mock("@dpf/db", () => ({ prisma: {
  remoteAction: { findUnique: remoteFindUnique },
  workroom: { findUnique: roomFindUnique, update: roomUpdate },
  workroomActivity: { create: activityCreate },
} }));
vi.mock("@/lib/change-management/register-change", () => ({ driveChangeThrough: vi.fn() }));
vi.mock("@/lib/self-upgrade/quiescence", () => ({ signalSwapComplete: vi.fn(), failQuiescenceSwap: vi.fn() }));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new Request("http://test/api/v1/edge/actions/result", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("native Edge qualification result ingestion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.DPF_REMOTE_ACTION_DISPATCH_ENABLED = "true";
    mockResolveToken.mockResolvedValue({ ok: true, edgeNodeRowId: "edge-row-1" });
    mockResolveMtls.mockResolvedValue({ ok: true, certificateId: "cert-1" });
    mockRecordResult.mockResolvedValue({ ok: true, status: "succeeded" });
  });

  it("settles the bound Workroom only after the machine-authenticated Edge result", async () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const actionKey = "ra_qw_composed";
    const state = { schemaVersion: 1, status: "started", token: "token", bindingDigest: digest,
      startCount: 1, issuedAt: "2026-10-30T01:00:00.000Z", startedAt: "2026-10-30T01:01:00.000Z", taskId: actionKey };
    remoteFindUnique.mockResolvedValue({ actionKey, edgeNodeId: "edge-row-1",
      actionType: "qualification.windows.verify-v1", status: "succeeded",
      parameters: { workroomId: "WC-1", qualificationBindingDigest: digest,
        headSha: "b".repeat(40), testBlobs: [{ blobSha: "c".repeat(40) }] },
      evidence: { boundedOutputDigest: "d".repeat(64), startedAt: "2026-10-30T01:02:00Z",
        finishedAt: "2026-10-30T01:03:00Z", command: "node --test scripts/lib/local-ci-gate-state.test.mjs",
        exitCode: 0, sourceFileCount: 3, outputTruncated: false } });
    roomFindUnique.mockResolvedValue({ id: "room-row", workspaceState: { qualificationExperimentAdmission: state } });
    activityCreate.mockResolvedValue({ id: "evidence-1" });

    const response = await POST(request({ actionKey, outcome: "succeeded",
      evidence: { exitCode: 0, outputTruncated: false } }));

    expect(response.status).toBe(200);
    expect(mockResolveMtls).toHaveBeenCalled();
    expect(activityCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      recordedByAgentId: "edge-row-1", payload: expect.objectContaining({ result: expect.objectContaining({
        qualificationOutcome: "positive", researchSatisfied: false,
      }) }),
    }) }));
    expect(roomUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { workspaceState: expect.objectContaining({
      qualificationExperimentAdmission: expect.objectContaining({ status: "settled", evidenceId: "evidence-1" }),
    }) } }));
  });
});
