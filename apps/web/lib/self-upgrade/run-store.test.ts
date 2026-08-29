import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  executeRawUnsafe: vi.fn(),
  broadcastSystem: vi.fn(),
  recordCorrectiveRecoveryEvidence: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: (() => {
    const selfUpgradeRun = {
      create: mocks.create,
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      update: mocks.update,
      updateMany: mocks.updateMany,
    };
    return {
      selfUpgradeRun,
      $transaction: (callback: (tx: { selfUpgradeRun: typeof selfUpgradeRun; $executeRawUnsafe: typeof mocks.executeRawUnsafe }) => unknown) =>
        callback({ selfUpgradeRun, $executeRawUnsafe: mocks.executeRawUnsafe }),
    };
  })(),
}));
vi.mock("@/lib/self-upgrade/change-record", () => ({ safeSyncSelfUpgradeChangeRecord: vi.fn() }));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { broadcastSystem: mocks.broadcastSystem },
}));
vi.mock("@/lib/backlog/capture-corrective-bi", () => ({
  captureCorrectiveFailureBI: vi.fn(),
  recordCorrectiveRecoveryEvidence: mocks.recordCorrectiveRecoveryEvidence,
}));

import {
  createRun,
  startRun,
  completeRun,
  recordPromoterReadiness,
  recordRunRecoveryPoint,
  sanitizePromoterReadinessReport,
  claimAdmittedRunForWorker,
  selfUpgradeAdmissionRepository,
} from "./run-store";

const report = {
  stage: "preflight" as const, owner: "portal" as const, mode: "enforced" as const,
  result: "failed" as const, targetSha: "candidate", startedAt: "2026-07-18T00:00:00Z",
  completedAt: "2026-07-18T00:00:01Z", quiescenceBegan: false as const,
  failures: [{ code: "state", message: "token=dpfmcp_sensitive", remediation: "password=hunter2 repair state" }],
};

describe("self-upgrade evidence merging", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({}); });

  it("redacts readiness messages and caps failures", () => {
    const sanitized = sanitizePromoterReadinessReport({ ...report, failures: Array.from({ length: 20 }, (_, i) => ({ code: `c${i}`, message: `secret=value-${i}` })) });
    expect(sanitized.failures).toHaveLength(12);
    expect(JSON.stringify(sanitized)).not.toContain("value-");
  });

  it("replaces readiness while preserving recovery, rollback, and future evidence", async () => {
    mocks.findUnique.mockResolvedValue({ completionEvidence: { readiness: { result: "ready", completedAt: "earlier" }, recoveryPoint: { status: "ok" }, rollback: { status: "ok" }, future: 42 } });
    await recordPromoterReadiness("SUR-1", report);
    const evidence = mocks.update.mock.calls[0][0].data.completionEvidence;
    expect(evidence).toMatchObject({ recoveryPoint: { status: "ok" }, rollback: { status: "ok" }, future: 42, readiness: { stage: "preflight", result: "failed", attempts: [{ result: "ready", completedAt: "earlier", failureCodes: [] }] } });
  });

  it("preserves readiness when the recovery point is recorded", async () => {
    mocks.findUnique.mockResolvedValue({ completionEvidence: { readiness: report, rollback: { status: "pending" } } });
    await recordRunRecoveryPoint("SUR-1", { status: "ok" });
    expect(mocks.update.mock.calls[0][0].data.completionEvidence).toMatchObject({ readiness: report, rollback: { status: "pending" }, recoveryPoint: { status: "ok" } });
  });
});

describe("self-upgrade lifecycle invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(({ data }) => Promise.resolve({ ...data }));
    mocks.update.mockImplementation(({ data, where }) =>
      Promise.resolve({ runId: where.runId, ...data }),
    );
  });

  it("publishes queued, running, and terminal hints after durable writes", async () => {
    const created = await createRun({ runId: "SUR-LIVE" });
    await startRun("SUR-LIVE");
    await completeRun("SUR-LIVE");

    expect(created.status).toBe("queued");
    expect(mocks.broadcastSystem.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "queued" }),
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "running" }),
      expect.objectContaining({ type: "system:self-upgrade", runId: "SUR-LIVE", status: "succeeded" }),
    ]);
  });

  it("records non-closing corrective recovery evidence with exact run identity", async () => {
    mocks.update.mockResolvedValue({
      runId: "SUR-RECOVERED",
      status: "succeeded",
      currentSha: "before-sha",
      targetSha: "target-sha",
      deployedSha: "deployed-sha",
      completedAt: new Date("2026-08-14T00:00:00.000Z"),
    });

    await completeRun("SUR-RECOVERED");

    expect(mocks.recordCorrectiveRecoveryEvidence).toHaveBeenCalledWith({
      source: "self-upgrade-failure",
      recovery: {
        runId: "SUR-RECOVERED",
        currentSha: "before-sha",
        targetSha: "target-sha",
        deployedSha: "deployed-sha",
        completedAt: new Date("2026-08-14T00:00:00.000Z"),
      },
    });
  });

  it("does not fail a durable transition when notification delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.broadcastSystem.mockImplementation(() => {
      throw new Error("stream consumer failed");
    });

    await expect(startRun("SUR-DURABLE")).resolves.toMatchObject({
      runId: "SUR-DURABLE",
      status: "running",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});

describe("admitted worker ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ status: "queued", dispatchStatus: "dispatched" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("claims the durable admission with one database compare-and-swap", async () => {
    await expect(claimAdmittedRunForWorker("SUR-ONE")).resolves.toBe("claimed");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        runId: "SUR-ONE",
        status: { in: ["pending", "queued"] },
        dispatchStatus: { in: ["dispatching", "dispatched"] },
      },
      data: { status: "running", startedAt: expect.any(Date) },
    });
  });

  it("refuses duplicate delivery after the claim is consumed", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimAdmittedRunForWorker("SUR-ONE")).resolves.toBe("duplicate");
  });

  it("preserves the legacy path for historical queued runs", async () => {
    mocks.findUnique.mockResolvedValue({ status: "queued", dispatchStatus: null });
    await expect(claimAdmittedRunForWorker("SUR-LEGACY")).resolves.toBe("legacy");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("records the queue acknowledgement even when the worker finishes before send returns", async () => {
    mocks.findUnique.mockResolvedValue({
      status: "succeeded",
      dispatchStatus: "dispatching",
      dispatchLeaseToken: "lease-1",
    });
    mocks.update.mockResolvedValue({});

    await expect(
      selfUpgradeAdmissionRepository.acknowledgeDispatch({
        runId: "SUR-FAST",
        leaseToken: "lease-1",
        eventIds: ["event-1"],
        acknowledgedAt: new Date("2026-08-29T04:00:00.000Z"),
      }),
    ).resolves.toBe(true);

    expect(mocks.update).toHaveBeenCalledWith({
      where: { runId: "SUR-FAST" },
      data: expect.objectContaining({
        dispatchStatus: "dispatched",
        dispatchEventIds: ["event-1"],
      }),
    });
    expect(mocks.update.mock.calls.at(-1)?.[0].data).not.toHaveProperty("status");
  });
});

describe("self-upgrade admission transaction", () => {
  const admittedRow = {
    runId: "SUR-ADMITTED",
    status: "pending",
    trigger: "manual:user-1",
    targetSha: "a".repeat(40),
    targetTag: "v1",
    requestedForce: false,
    dryRun: false,
    routine: false,
    impactSummaryId: null,
    admissionFingerprint: "fingerprint-1",
    dispatchStatus: "admission_pending",
    dispatchAttemptCount: 0,
    dispatchLeaseToken: null,
    dispatchLeaseExpiresAt: null,
    dispatchEventIds: [],
    completedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(admittedRow);
  });

  it("persists the exact binding before any dispatcher can observe the run", async () => {
    await expect(selfUpgradeAdmissionRepository.admit({
      runId: admittedRow.runId,
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha: admittedRow.targetSha, targetTag: admittedRow.targetTag },
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: admittedRow.admissionFingerprint,
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "created", run: admittedRow });

    expect(mocks.executeRawUnsafe).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext('self-upgrade-admission'))",
    );
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: "pending",
      targetSha: admittedRow.targetSha,
      targetTag: admittedRow.targetTag,
      admissionFingerprint: admittedRow.admissionFingerprint,
      dispatchStatus: "admission_pending",
    }) });
  });

  it("returns the same active admission for the same fingerprint", async () => {
    mocks.findFirst.mockResolvedValue(admittedRow);
    const result = await selfUpgradeAdmissionRepository.admit({
      runId: "SUR-IGNORED",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha: admittedRow.targetSha, targetTag: admittedRow.targetTag },
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: admittedRow.admissionFingerprint,
      dispatchStatus: "admission_pending",
    });

    expect(result).toMatchObject({ disposition: "idempotent", run: admittedRow });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
