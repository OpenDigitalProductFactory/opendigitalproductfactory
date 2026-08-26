import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordExternalEvidence } = vi.hoisted(() => ({
  mockRecordExternalEvidence: vi.fn().mockResolvedValue({ id: "external-1" }),
}));

vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: mockRecordExternalEvidence,
}));

import { recordLocalIntegrationResult } from "./local-integration";

describe("recordLocalIntegrationResult", () => {
  const platformConfig = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };
  const environmentLease = {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    environmentLease.updateMany.mockResolvedValue({ count: 1 });
  });

  it("binds immutable gate evidence only when the recording session owns the canonical lease", async () => {
    const gateKey = "a".repeat(64);
    environmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-GATE",
      claimKey: `gate:${gateKey}`,
      ownerSessionId: "codex-session-1",
      status: "active",
      evidenceRecordId: null,
    });

    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-1",
      routeContext: "/build",
      candidateBranch: "feat/immutable-gate",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      gateKey,
      leaseId: "NPEL-GATE",
      evidence: { integrationTreeSha: "b".repeat(40) },
    }, { platformConfig, environmentLease });

    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ gateKey, leaseId: "NPEL-GATE" }),
    }));
    expect(environmentLease.updateMany).toHaveBeenCalledWith({
      where: {
        leaseId: "NPEL-GATE",
        claimKey: `gate:${gateKey}`,
        ownerSessionId: "codex-session-1",
        evidenceRecordId: null,
      },
      data: { evidenceRecordId: "external-1" },
    });
  });

  it("refuses a subscriber attempt to record the canonical executor result", async () => {
    environmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-GATE",
      claimKey: `gate:${"a".repeat(64)}`,
      ownerSessionId: "winner-session",
      status: "active",
      evidenceRecordId: null,
    });

    await expect(recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "subscriber-session",
      routeContext: "/build",
      candidateBranch: "feat/immutable-gate",
      mode: "single-branch",
      status: "passed",
      summary: "Must not record.",
      gateKey: "a".repeat(64),
      leaseId: "NPEL-GATE",
      evidence: {},
    }, { platformConfig, environmentLease })).rejects.toThrow(/owner/i);

    expect(mockRecordExternalEvidence).not.toHaveBeenCalled();
  });

  it("records local integration output as external evidence", async () => {
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-1",
      routeContext: "/build",
      buildId: "FB-1",
      taskRunId: "TR-1",
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      evidence: { commands: ["pnpm --filter web typecheck"] },
    }, { platformConfig });

    expect(mockRecordExternalEvidence).toHaveBeenCalledWith({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "local_integration_ci",
      target: "feat/build-studio-decision-skills-slice-1",
      provider: "codex",
      resultSummary: "Merged-code gate passed.",
      buildId: "FB-1",
      taskRunId: "TR-1",
      details: {
        externalSessionId: "codex-session-1",
        mode: "single-branch",
        status: "passed",
        capacityCircuitBreaker: "not-applicable",
        evidence: { commands: ["pnpm --filter web typecheck"] },
      },
    });
  });

  it("records blocked_sandbox_drift with freshness evidence (a sandbox defect, not a product failure)", async () => {
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "claude",
      externalSessionId: "gate-42",
      routeContext: "/build",
      candidateBranch: "doc/some-branch",
      mode: "single-branch",
      status: "blocked_sandbox_drift",
      summary: "local-CI gate blocked: sandbox dependency state is stale. NOT product build evidence.",
      evidence: {
        freshness: {
          verdict: "sandbox_drift",
          packages: [{ name: "next", locked: "16.2.9", resolved: "16.2.7" }],
        },
      },
    });

    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "local_integration_ci",
        details: expect.objectContaining({ status: "blocked_sandbox_drift" }),
      }),
    );
  });

  it("records control-plane starvation as infrastructure evidence", async () => {
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "gate-starved",
      routeContext: "/build",
      candidateBranch: "fix/control-plane",
      mode: "single-branch",
      status: "blocked_control_plane_starvation",
      summary: "The shared control-plane degraded during the production build.",
      evidence: { controlPlane: { samples: 2, healthyThroughout: false } },
    }, { platformConfig });

    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          status: "blocked_control_plane_starvation",
        }),
      }),
    );
  });

  it("contracts the pool before recording a failed slot-1 result", async () => {
    const updatedAt = new Date("2026-07-30T12:00:00.000Z");
    platformConfig.findUnique.mockResolvedValueOnce({
      value: {
        version: 1,
        requestedCapacity: 2,
        ceilings: {
          minAvailableMemoryBytes: 8 * 1024 ** 3,
          maxSustainedCpuPercent: 75,
          minDiskFreeBytes: 100 * 1024 ** 3,
        },
        rollback: {
          maxServiceDurationRegressionPercent: 15,
          maxInfrastructureFailureRatePercent: 5,
          evidenceMismatchTolerance: 0,
        },
      },
      updatedAt,
    });
    platformConfig.updateMany.mockResolvedValueOnce({ count: 1 });

    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "antigravity",
      externalSessionId: "agy-1",
      routeContext: "/build",
      candidateBranch: "feat/slot-one-failure",
      mode: "single-branch",
      status: "failed",
      summary: "Slot 1 failed.",
      evidence: {
        slotManifest: { slotKey: "slot-1" },
      },
    }, { platformConfig });

    expect(platformConfig.updateMany).toHaveBeenCalledWith({
      where: {
        key: "local_ci.sandbox_pool",
        updatedAt: { equals: updatedAt },
      },
      data: {
        value: expect.objectContaining({ requestedCapacity: 1 }),
      },
    });
    expect(mockRecordExternalEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          capacityCircuitBreaker: "contracted",
        }),
      }),
    );
  });

  it("does not record evidence when safe contraction loses every concurrency race", async () => {
    platformConfig.findUnique.mockResolvedValue({
      value: {
        version: 1,
        requestedCapacity: 2,
        ceilings: {
          minAvailableMemoryBytes: 8 * 1024 ** 3,
          maxSustainedCpuPercent: 75,
          minDiskFreeBytes: 100 * 1024 ** 3,
        },
        rollback: {
          maxServiceDurationRegressionPercent: 15,
          maxInfrastructureFailureRatePercent: 5,
          evidenceMismatchTolerance: 0,
        },
      },
      updatedAt: new Date("2026-07-30T12:00:00.000Z"),
    });
    platformConfig.updateMany.mockResolvedValue({ count: 0 });

    await expect(recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-2",
      routeContext: "/build",
      candidateBranch: "feat/slot-one-race",
      mode: "single-branch",
      status: "failed",
      summary: "Slot 1 failed.",
      evidence: {
        slotManifest: { slotKey: "slot-1" },
      },
    }, { platformConfig })).rejects.toThrow("could not persist");

    expect(mockRecordExternalEvidence).not.toHaveBeenCalled();
  });
});
