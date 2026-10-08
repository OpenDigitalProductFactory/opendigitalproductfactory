import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordExternalEvidence } = vi.hoisted(() => ({
  mockRecordExternalEvidence: vi.fn().mockResolvedValue({ id: "external-1" }),
}));

vi.mock("@/lib/actions/external-evidence", () => ({
  recordExternalEvidence: mockRecordExternalEvidence,
}));

import { recordLocalIntegrationResult, TEST_STUB_EVIDENCE_REFUSED } from "./local-integration";

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

  it("AC-2: a leased gate result folds its builder peak into the calibration row", async () => {
    const gateKey = "c".repeat(64);
    environmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-PEAK",
      claimKey: `gate:${gateKey}`,
      ownerSessionId: "claude-session-1",
      status: "active",
      evidenceRecordId: null,
    });
    const builderCalibration = {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
    };

    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "claude",
      externalSessionId: "claude-session-1",
      routeContext: "/build",
      candidateBranch: "feat/measured-reserve",
      mode: "single-branch",
      status: "passed",
      summary: "Merged-code gate passed.",
      gateKey,
      leaseId: "NPEL-PEAK",
      evidence: {
        controlPlane: {
          builderMemory: {
            bi: "BI-D3BF53A9",
            status: "measured",
            peakBytes: 7 * 1024 ** 3,
            peakScope: "this-build",
            memoryLimitBytes: 16 * 1024 ** 3,
            oomKills: 0,
          },
        },
      },
    }, { platformConfig, environmentLease, builderCalibration });

    expect(builderCalibration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "local_ci.builder_memory_calibration",
        value: expect.objectContaining({
          samples: [expect.objectContaining({ peakBytes: 7 * 1024 ** 3, oomKills: 0 })],
        }),
      }),
    });
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ builderMemoryCalibration: "recorded" }),
    }));
  });

  it("AC-2: an unleased result never feeds the calibration, and a store failure never blocks recording", async () => {
    const builderCalibration = {
      findUnique: vi.fn().mockRejectedValue(new Error("db down")),
      updateMany: vi.fn(),
      create: vi.fn(),
    };
    const evidence = {
      controlPlane: {
        builderMemory: { status: "measured", peakBytes: 7 * 1024 ** 3, oomKills: 0, memoryLimitBytes: 16 * 1024 ** 3 },
      },
    };
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "claude",
      externalSessionId: "claude-session-1",
      routeContext: "/build",
      candidateBranch: "feat/measured-reserve",
      mode: "single-branch",
      status: "passed",
      summary: "Unleased.",
      evidence,
    }, { platformConfig, builderCalibration });
    expect(builderCalibration.findUnique).not.toHaveBeenCalled();

    const gateKey = "d".repeat(64);
    environmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-DOWN",
      claimKey: `gate:${gateKey}`,
      ownerSessionId: "claude-session-1",
      status: "active",
      evidenceRecordId: null,
    });
    await expect(recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "claude",
      externalSessionId: "claude-session-1",
      routeContext: "/build",
      candidateBranch: "feat/measured-reserve",
      mode: "single-branch",
      status: "passed",
      summary: "Store down.",
      gateKey,
      leaseId: "NPEL-DOWN",
      evidence,
    }, { platformConfig, environmentLease, builderCalibration })).resolves.toBeDefined();
    expect(mockRecordExternalEvidence).toHaveBeenLastCalledWith(expect.objectContaining({
      details: expect.objectContaining({ builderMemoryCalibration: "error" }),
    }));
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
        builderMemoryCalibration: "not-leased",
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

describe("recordLocalIntegrationResult — evidence output offload (BI-39AAE9B8)", () => {
  const platformConfig = { findUnique: vi.fn(), updateMany: vi.fn() };
  const environmentLease = { findUnique: vi.fn(), updateMany: vi.fn() };

  it("moves an oversized evidence.output to the blob writer and records an excerpt plus reference", async () => {
    vi.clearAllMocks();
    const written: string[] = [];
    const writeEvidenceBlob = async (text: string) => {
      written.push(text);
      return { sha256: "f".repeat(64), storageKey: `documents/sha256/ff/ff/${"f".repeat(64)}`, sizeBytes: text.length, mimeType: "text/plain" as const };
    };
    const log = `${"=".repeat(100 * 1024)}\nTests 12 passed\n`;

    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-9",
      routeContext: "/build",
      candidateBranch: "feat/big-log",
      mode: "single-branch",
      status: "passed",
      summary: "gate passed",
      evidence: { sha: "c".repeat(40), commands: ["pnpm test"], output: log },
    }, { platformConfig, environmentLease, writeEvidenceBlob });

    expect(written).toEqual([log]);
    const call = mockRecordExternalEvidence.mock.calls.at(-1)?.[0] as { details: { evidence: { output: string; outputBlob: { sha256: string }; outputTruncated: boolean; sha: string } } };
    expect(call.details.evidence.outputTruncated).toBe(true);
    expect(call.details.evidence.outputBlob.sha256).toBe("f".repeat(64));
    expect(call.details.evidence.sha).toBe("c".repeat(40));
    expect(call.details.evidence.output.endsWith("Tests 12 passed\n")).toBe(true);
    expect(call.details.evidence.output.length).toBeLessThan(log.length);
  });

  it("leaves small evidence exactly as submitted and never calls the blob writer", async () => {
    vi.clearAllMocks();
    const writeEvidenceBlob = vi.fn();
    const evidence = { sha: "d".repeat(40), output: "ok" };
    await recordLocalIntegrationResult({
      actorUserId: "user-1",
      provider: "codex",
      externalSessionId: "codex-session-9",
      routeContext: "/build",
      candidateBranch: "feat/small-log",
      mode: "single-branch",
      status: "passed",
      summary: "gate passed",
      evidence,
    }, { platformConfig, environmentLease, writeEvidenceBlob });
    expect(writeEvidenceBlob).not.toHaveBeenCalled();
    const call = mockRecordExternalEvidence.mock.calls.at(-1)?.[0] as { details: { evidence: unknown } };
    expect(call.details.evidence).toBe(evidence);
  });
});

// BI-F5344F65. A DPF_ALLOW_LOCAL_CI_STUB run builds nothing, yet reports
// status "passed" under a real lease. It marks its payload testStub, and the
// portal must record none of it: no evidence row a PR could cite, no pool-policy
// change and no builder calibration.
describe("recordLocalIntegrationResult refuses test-stub evidence", () => {
  const platformConfig = { findUnique: vi.fn(), updateMany: vi.fn() };
  const environmentLease = { findUnique: vi.fn(), updateMany: vi.fn() };
  const builderCalibration = { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const status of ["passed", "failed", "blocked_control_plane_starvation"] as const) {
    it(`refuses a ${status} stub result before it writes anything`, async () => {
      const gateKey = "e".repeat(64);
      environmentLease.findUnique.mockResolvedValue({
        leaseId: "NPEL-STUB",
        claimKey: `gate:${gateKey}`,
        ownerSessionId: "claude-session-stub",
        status: "active",
        evidenceRecordId: null,
      });

      await expect(recordLocalIntegrationResult({
        actorUserId: "user-1",
        provider: "claude",
        externalSessionId: "claude-session-stub",
        routeContext: "/build",
        candidateBranch: "fix/admitted-owner-recovery",
        mode: "single-branch",
        status,
        summary: "local-CI lease gate passed.",
        gateKey,
        leaseId: "NPEL-STUB",
        evidence: {
          testStub: true,
          gatePassed: status === "passed",
          buildCommand: "sandbox checkout/build stub",
          sha: "f".repeat(40),
          headTreeHash: "a".repeat(40),
        },
      }, { platformConfig, environmentLease, builderCalibration })).rejects.toMatchObject({
        code: TEST_STUB_EVIDENCE_REFUSED,
        message: expect.stringMatching(/DPF_ALLOW_LOCAL_CI_STUB/),
      });

      expect(mockRecordExternalEvidence).not.toHaveBeenCalled();
      expect(platformConfig.findUnique).not.toHaveBeenCalled();
      expect(platformConfig.updateMany).not.toHaveBeenCalled();
      expect(builderCalibration.findUnique).not.toHaveBeenCalled();
      expect(environmentLease.updateMany).not.toHaveBeenCalled();
    });
  }
});

// BI-C9912C22 AC-1: WC-BFDF763B was adopted before its first sync, so its
// headSha was still null when pregate passed for 4f51f57e9. The writer demanded
// headSha equality and stored the pass with workCapsuleId NULL, so no failure
// analysis for that room could ever cite it.
describe("local-CI evidence attribution to an adopted Workroom (BI-C9912C22)", () => {
  const gateKey = "d".repeat(64);
  const sha = "4f51f57e96397ee09a3cced5098491da720d7891";
  const platformConfig = { findUnique: vi.fn(), updateMany: vi.fn() };
  const environmentLease = { findUnique: vi.fn(), updateMany: vi.fn() };
  const builderCalibration = { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn(), create: vi.fn().mockResolvedValue({}) };
  const record = (workroom: { findMany: ReturnType<typeof vi.fn> }) => recordLocalIntegrationResult({
    actorUserId: "user-1",
    provider: "claude",
    externalSessionId: "cab18f6e-session",
    routeContext: "/build",
    candidateBranch: "fix/external-agents-decision-record-grant",
    mode: "single-branch",
    status: "passed",
    summary: "local-CI lease gate passed.",
    gateKey,
    leaseId: "NPEL-ADOPTED",
    evidence: { gatePassed: true, sha, headTreeHash: "e".repeat(40) },
  }, { platformConfig, environmentLease, builderCalibration, workroom } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    environmentLease.findUnique.mockResolvedValue({
      leaseId: "NPEL-ADOPTED", claimKey: `gate:${gateKey}`, ownerSessionId: "cab18f6e-session",
      status: "active", evidenceRecordId: null,
    });
    environmentLease.updateMany.mockResolvedValue({ count: 1 });
  });

  it("links the pass to the session's adopted room on the branch even before the room records its head", async () => {
    const workroom = { findMany: vi.fn().mockResolvedValue([{ id: "room-adopted", headSha: null }]) };
    await record(workroom);
    expect(workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { headBranch: "fix/external-agents-decision-record-grant", executorRef: "cab18f6e-session", archivedAt: null },
    }));
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({ workCapsuleId: "room-adopted" }));
  });

  it("links the pass when the room's recorded head is an older commit on the same branch", async () => {
    const workroom = { findMany: vi.fn().mockResolvedValue([{ id: "room-stale", headSha: "1".repeat(40) }]) };
    await record(workroom);
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({ workCapsuleId: "room-stale" }));
  });

  it("prefers the room whose head is exactly the gated commit", async () => {
    const workroom = { findMany: vi.fn().mockResolvedValue([
      { id: "room-other", headSha: null }, { id: "room-exact", headSha: sha },
    ]) };
    await record(workroom);
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({ workCapsuleId: "room-exact" }));
  });

  it("leaves the pass unlinked rather than guessing between two inexact rooms", async () => {
    const workroom = { findMany: vi.fn().mockResolvedValue([
      { id: "room-a", headSha: null }, { id: "room-b", headSha: "1".repeat(40) },
    ]) };
    await record(workroom);
    expect(mockRecordExternalEvidence).toHaveBeenCalledWith(expect.objectContaining({ workCapsuleId: undefined }));
  });
});
