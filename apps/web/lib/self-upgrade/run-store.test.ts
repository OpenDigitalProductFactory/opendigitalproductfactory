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
  deferAdmittedRunForRedispatch,
  selfUpgradeAdmissionRepository,
  failRun,
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

  it("returns a claimed worker to durable reconciliation before mutation begins", async () => {
    await expect(
      deferAdmittedRunForRedispatch("SUR-ONE", "release-target-registry-unavailable"),
    ).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        runId: "SUR-ONE",
        status: "running",
        completedAt: null,
        dispatchStatus: { in: ["dispatching", "dispatched"] },
      },
      data: {
        status: "pending",
        startedAt: null,
        dispatchStatus: "indeterminate",
        dispatchError: "release-target-registry-unavailable",
        dispatchLeaseToken: null,
        dispatchLeaseExpiresAt: null,
      },
    });
    expect(mocks.broadcastSystem).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "SUR-ONE", status: "pending" }),
    );
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
    recoveryOfRunId: null,
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
    dispatchAcknowledgedAt: null,
    completedAt: null,
  };

  beforeEach(() => {
    vi.resetAllMocks();
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

  it("creates one typed recovery successor without mutating the terminal predecessor", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        runId: "SUR-6B312E24",
        status: "failed",
        completedAt: new Date("2026-08-29T14:45:34.380Z"),
      });
    mocks.findUnique
      .mockResolvedValueOnce({
        ...admittedRow,
        runId: "SUR-6B312E24",
        status: "failed",
        targetSha: "0".repeat(40),
        targetTag: "v-old",
        completedAt: new Date("2026-08-29T14:45:34.380Z"),
      })
      .mockResolvedValueOnce(null);

    await selfUpgradeAdmissionRepository.admit({
      runId: "SUR-C137BOOT",
      triggeredBy: admittedRow.trigger,
      target: {
        targetKind: "release-artifact",
        targetSha: "c137e6cdb1fe82d00565841ec683cec5c80710ab",
        targetTag: "v2026.08.29-source-free-upgrade-reconciliation.1",
      },
      recoveryOfRunId: "SUR-6B312E24",
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "successor-fingerprint",
      dispatchStatus: "admission_pending",
    });

    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      runId: "SUR-C137BOOT",
      status: "pending",
      recoveryOfRunId: "SUR-6B312E24",
      targetSha: "c137e6cdb1fe82d00565841ec683cec5c80710ab",
    }) });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses a recovery successor when the predecessor is not the latest run", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ runId: "SUR-NEWER", status: "failed", completedAt: new Date() });
    mocks.findUnique.mockResolvedValueOnce({
      ...admittedRow,
      runId: "SUR-6B312E24",
      status: "failed",
      targetSha: "0".repeat(40),
      targetTag: "v-old",
      completedAt: new Date(),
    });

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-C137BOOT",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha: "c".repeat(40), targetTag: "v-new" },
      recoveryOfRunId: "SUR-6B312E24",
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "successor-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_refused", reason: "recovery-predecessor-not-latest" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses an untagged recovery target before persistence", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-INVALID",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "git-source", targetSha: "c".repeat(40), targetTag: null },
      recoveryOfRunId: "SUR-6B312E24",
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "invalid-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_refused", reason: "recovery-target-invalid" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates one typed successor for an exact-target predecessor that never dispatched", async () => {
    const predecessor = {
      ...admittedRow,
      runId: "SUR-6B312E24",
      status: "failed",
      targetSha: "0".repeat(40),
      targetTag: "v-old",
      completedAt: new Date(),
    };
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(predecessor);
    mocks.findUnique
      .mockResolvedValueOnce(predecessor)
      .mockResolvedValueOnce(null);
    mocks.create.mockImplementationOnce(({ data }) => Promise.resolve({
      ...admittedRow,
      ...data,
    }));

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-SAME",
      triggeredBy: admittedRow.trigger,
      target: {
        targetKind: "release-artifact",
        targetSha: predecessor.targetSha,
        targetTag: predecessor.targetTag,
      },
      recoveryOfRunId: predecessor.runId,
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "same-target-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({
      disposition: "created",
      run: {
        runId: "SUR-SAME",
        recoveryOfRunId: predecessor.runId,
        targetSha: predecessor.targetSha,
        targetTag: predecessor.targetTag,
      },
    });
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it.each([
    ["same SHA only", "0".repeat(40), "v-new"],
    ["same tag only", "c".repeat(40), "v-old"],
  ])("refuses a successor with conflicting predecessor identity: %s", async (_case, targetSha, targetTag) => {
    const predecessor = {
      ...admittedRow,
      runId: "SUR-6B312E24",
      status: "failed",
      targetSha: "0".repeat(40),
      targetTag: "v-old",
      completedAt: new Date(),
    };
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.findUnique.mockResolvedValueOnce(predecessor);

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-SAME",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha, targetTag },
      recoveryOfRunId: predecessor.runId,
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "same-target-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_refused", reason: "recovery-target-not-distinct" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a malformed terminal predecessor without throwing", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.findUnique.mockResolvedValueOnce({ ...admittedRow, runId: "SUR-BAD", status: "failed", completedAt: null });

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-REFUSED",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha: "c".repeat(40), targetTag: "v-new" },
      recoveryOfRunId: "SUR-BAD",
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "refused-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_refused", reason: "recovery-predecessor-not-terminal" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a terminal predecessor with ambiguous dispatch evidence", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.findUnique.mockResolvedValueOnce({
      ...admittedRow,
      runId: "SUR-AMBIGUOUS",
      status: "failed",
      targetSha: "0".repeat(40),
      targetTag: "v-old",
      completedAt: new Date(),
      dispatchAttemptCount: 1,
    });

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-REFUSED",
      triggeredBy: admittedRow.trigger,
      target: { targetKind: "release-artifact", targetSha: "c".repeat(40), targetTag: "v-new" },
      recoveryOfRunId: "SUR-AMBIGUOUS",
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "refused-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_refused", reason: "recovery-predecessor-ambiguous" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns the existing typed successor instead of creating a second one", async () => {
    const predecessor = {
      ...admittedRow,
      runId: "SUR-6B312E24",
      status: "failed",
      targetSha: "0".repeat(40),
      targetTag: "v-old",
      completedAt: new Date(),
    };
    const successor = {
      ...admittedRow,
      runId: "SUR-EXISTING",
      recoveryOfRunId: predecessor.runId,
      targetSha: predecessor.targetSha,
      targetTag: predecessor.targetTag,
    };
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(predecessor);
    mocks.findUnique
      .mockResolvedValueOnce(predecessor)
      .mockResolvedValueOnce(successor);

    await expect(selfUpgradeAdmissionRepository.admit({
      runId: "SUR-SECOND",
      triggeredBy: admittedRow.trigger,
      target: {
        targetKind: "release-artifact",
        targetSha: predecessor.targetSha,
        targetTag: predecessor.targetTag,
      },
      recoveryOfRunId: predecessor.runId,
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
      admissionFingerprint: "second-fingerprint",
      dispatchStatus: "admission_pending",
    })).resolves.toMatchObject({ disposition: "recovery_conflict", run: successor });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// BI: a failed run must record WHY on the row, not only in failureLog.
// `skipRun` always wrote a structured `reason`; `failRun` never did, so 55 of
// 55 failed runs on the live install showed the operator nothing but a raw
// Docker log behind a tooltip — hiding two multi-day outages.
describe("failRun records an operator-readable reason", () => {
  beforeEach(() => {
    mocks.update.mockResolvedValue({ runId: "SUR-TEST", status: "failed" });
  });

  it("derives the reason from the failure log when the caller supplies none", async () => {
    await failRun(
      "SUR-TEST",
      "#42 12.4 ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with frozen-lockfile",
    );
    const data = mocks.update.mock.calls.at(-1)?.[0]?.data;
    expect(data.status).toBe("failed");
    expect(data.reason).toBe("pnpm-install-failure");
    // The full log is still persisted — the reason summarises, never replaces.
    expect(data.failureLog).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
  });

  it("prefers a reason the caller already knows", async () => {
    await failRun("SUR-TEST", "some long log", "promoter-readiness-failed: image missing");
    expect(mocks.update.mock.calls.at(-1)?.[0]?.data.reason).toBe(
      "promoter-readiness-failed: image missing",
    );
  });

  it("never writes an empty reason, whatever the log looks like", async () => {
    for (const log of ["", "   ", "totally unrecognised output"]) {
      await failRun("SUR-TEST", log);
      const reason = mocks.update.mock.calls.at(-1)?.[0]?.data.reason;
      expect(typeof reason).toBe("string");
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("bounds the reason so the column never carries a whole build log", async () => {
    await failRun("SUR-TEST", "y".repeat(10_000));
    expect(mocks.update.mock.calls.at(-1)?.[0]?.data.reason.length).toBeLessThanOrEqual(200);
  });
});
