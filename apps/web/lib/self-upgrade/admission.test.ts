import { describe, expect, it, vi } from "vitest";
import {
  createSelfUpgradeAdmissionService,
  computeSelfUpgradeAdmissionFingerprint,
  isDefiniteSelfUpgradeDispatchRefusal,
  type SelfUpgradeAdmissionRecord,
  type SelfUpgradeAdmissionRepository,
  type SelfUpgradeTargetBinding,
} from "./admission";

const target: SelfUpgradeTargetBinding = {
  targetKind: "release-artifact",
  targetSha: "d9ed4bdb9b095d423a7d20b61c0798393f365be6",
  targetTag: "v2026.08.29-review-prerequisite-recovery.1",
};

function record(overrides: Partial<SelfUpgradeAdmissionRecord> = {}): SelfUpgradeAdmissionRecord {
  const row: SelfUpgradeAdmissionRecord = {
    runId: "SUR-D71E8971",
    status: "pending",
    trigger: "manual:user-1",
    targetSha: target.targetSha,
    targetTag: target.targetTag,
    requestedForce: false,
    dryRun: false,
    routine: false,
    impactSummaryId: null,
    admissionFingerprint: "",
    dispatchStatus: "admission_pending",
    dispatchAttemptCount: 0,
    dispatchLeaseToken: null,
    dispatchLeaseExpiresAt: null,
    completedAt: null,
    ...overrides,
  };
  return {
    ...row,
    admissionFingerprint: overrides.admissionFingerprint ?? computeSelfUpgradeAdmissionFingerprint({
      triggeredBy: row.trigger,
      target,
      requestedForce: row.requestedForce,
      dryRun: row.dryRun,
      routine: row.routine,
      impactSummaryId: row.impactSummaryId,
    }),
  };
}

function repository(initial = record()): SelfUpgradeAdmissionRepository & {
  row: SelfUpgradeAdmissionRecord;
} {
  const repo: SelfUpgradeAdmissionRepository & { row: SelfUpgradeAdmissionRecord } = {
    row: initial,
    admit: vi.fn(async (input) => {
      repo.row = { ...initial, ...input };
      return { disposition: "created" as const, run: repo.row };
    }),
    read: vi.fn(async () => repo.row),
    claimDispatch: vi.fn(async (input) => {
      repo.row = {
        ...repo.row,
        dispatchStatus: "dispatching" as const,
        dispatchAttemptCount: repo.row.dispatchAttemptCount + 1,
        dispatchLeaseToken: input.leaseToken,
        dispatchLeaseExpiresAt: input.leaseExpiresAt,
      };
      return { claimed: true as const, run: repo.row };
    }),
    acknowledgeDispatch: vi.fn(async (input) => {
      repo.row = {
        ...repo.row,
        status: "queued",
        dispatchStatus: "dispatched",
        dispatchLeaseToken: null,
        dispatchLeaseExpiresAt: null,
        dispatchEventIds: input.eventIds,
      };
      return true;
    }),
    markDispatchIndeterminate: vi.fn(async () => {
      repo.row = {
        ...repo.row,
        dispatchStatus: "indeterminate",
        dispatchLeaseToken: null,
        dispatchLeaseExpiresAt: null,
      };
      return true;
    }),
    failDispatch: vi.fn(async () => {
      repo.row = { ...repo.row, status: "failed", dispatchStatus: "dispatch_failed" };
      return true;
    }),
    listRecoverable: vi.fn(async () => [repo.row]),
  } satisfies SelfUpgradeAdmissionRepository & { row: SelfUpgradeAdmissionRecord };
  return repo;
}

function service(overrides: {
  repository?: SelfUpgradeAdmissionRepository;
  send?: (event: unknown) => Promise<{ ids: string[] }>;
  resolveTarget?: () => Promise<SelfUpgradeTargetBinding | null>;
  readJobEngineHealth?: () => Promise<{ status: "healthy" | "degraded" | "unknown" }>;
  schedule?: (task: () => Promise<void>) => void;
} = {}) {
  const schedule = vi.fn(overrides.schedule ?? (() => undefined));
  const send = vi.fn(overrides.send ?? (async () => ({ ids: ["evt-1"] })));
  const resolveTarget = vi.fn(overrides.resolveTarget ?? (async () => target));
  const readJobEngineHealth = vi.fn(
    overrides.readJobEngineHealth ?? (async () => ({ status: "healthy" as const })),
  );
  return {
    schedule,
    send,
    resolveTarget,
    readJobEngineHealth,
    coordinator: createSelfUpgradeAdmissionService({
      repository: overrides.repository ?? repository(),
      send,
      resolveTarget,
      readJobEngineHealth,
      schedule,
      createRunId: () => "SUR-D71E8971",
      createLeaseToken: () => "lease-1",
      now: () => new Date("2026-08-29T02:51:37.044Z"),
    }),
  };
}

describe("durable self-upgrade admission", () => {
  it("returns a server-issued run before the post-response dispatch starts", async () => {
    const repo = repository();
    const { coordinator, schedule, send } = service({ repository: repo });

    const accepted = await coordinator.admit({
      triggeredBy: "manual:user-1",
      target,
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
    });

    expect(accepted).toMatchObject({
      admitted: true,
      disposition: "created",
      runId: "SUR-D71E8971",
    });
    expect(repo.row).toMatchObject({
      status: "pending",
      targetSha: target.targetSha,
      targetTag: target.targetTag,
      dispatchStatus: "admission_pending",
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("reconciles a delayed dispatch with the same stable event identity", async () => {
    const repo = repository();
    const { coordinator, schedule, send } = service({ repository: repo });
    await coordinator.admit({
      triggeredBy: "manual:user-1",
      target,
      requestedForce: false,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
    });

    const callback = schedule.mock.calls[0]![0] as () => Promise<void>;
    await callback();

    expect(send).toHaveBeenCalledWith({
      id: "self-upgrade:SUR-D71E8971",
      name: "ops/self-upgrade.run",
      data: {
        runId: "SUR-D71E8971",
        triggeredBy: "manual:user-1",
      },
    });
    expect(repo.row).toMatchObject({ status: "queued", dispatchStatus: "dispatched" });
  });

  it("keeps a transport exception indeterminate and recoverable instead of inventing rejection", async () => {
    const repo = repository();
    const send = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const { coordinator } = service({ repository: repo, send });

    const outcome = await coordinator.dispatch("SUR-D71E8971");

    expect(outcome).toEqual({ status: "indeterminate", runId: "SUR-D71E8971" });
    expect(repo.markDispatchIndeterminate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "SUR-D71E8971", leaseToken: "lease-1" }),
    );
    expect(repo.failDispatch).not.toHaveBeenCalled();
  });

  it("records a definite queue refusal without retrying an invalid event", async () => {
    const repo = repository();
    const send = vi.fn(async () => {
      throw new Error("Inngest API Error: 400 Cannot process event payload");
    });
    const { coordinator } = service({ repository: repo, send });

    expect(await coordinator.dispatch("SUR-D71E8971")).toEqual({
      status: "failed",
      runId: "SUR-D71E8971",
    });
    expect(repo.failDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expect.stringContaining("queue-dispatch-refused") }),
    );
    expect(repo.markDispatchIndeterminate).not.toHaveBeenCalled();
  });

  it("waits for degraded job-engine health without consuming a send", async () => {
    const repo = repository();
    const { coordinator, send } = service({
      repository: repo,
      readJobEngineHealth: vi.fn(async () => ({ status: "degraded" as const })),
    });

    const outcome = await coordinator.dispatch("SUR-D71E8971");

    expect(outcome).toEqual({ status: "indeterminate", runId: "SUR-D71E8971" });
    expect(send).not.toHaveBeenCalled();
    expect(repo.markDispatchIndeterminate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "job-engine-degraded" }),
    );
  });

  it("also keeps unknown job-engine health recoverable", async () => {
    const repo = repository();
    const { coordinator, send } = service({
      repository: repo,
      readJobEngineHealth: async () => ({ status: "unknown" as const }),
    });

    expect(await coordinator.dispatch("SUR-D71E8971")).toEqual({
      status: "indeterminate",
      runId: "SUR-D71E8971",
    });
    expect(send).not.toHaveBeenCalled();
    expect(repo.markDispatchIndeterminate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "job-engine-unknown" }),
    );
  });

  it("does not dispatch a distinct request while another admission is active", async () => {
    const repo = repository();
    repo.admit = vi.fn(async () => ({
      disposition: "already_active" as const,
      run: repo.row,
    }));
    const { coordinator, schedule } = service({ repository: repo });

    const result = await coordinator.admit({
      triggeredBy: "manual:user-2",
      target,
      requestedForce: true,
      dryRun: false,
      routine: false,
      impactSummaryId: null,
    });

    expect(result).toMatchObject({ admitted: false, disposition: "already_active" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("fails closed when the current target no longer matches the admitted release", async () => {
    const repo = repository();
    const { coordinator, send } = service({
      repository: repo,
      resolveTarget: vi.fn(async () => ({ ...target, targetSha: "newer-sha" })),
    });

    const outcome = await coordinator.dispatch("SUR-D71E8971");

    expect(outcome).toEqual({ status: "failed", runId: "SUR-D71E8971" });
    expect(repo.failDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "admission-target-drift" }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps an exact persisted admission reconcilable while release discovery is unavailable", async () => {
    const repo = repository();
    const { coordinator, send } = service({
      repository: repo,
      resolveTarget: vi.fn(async () => null),
    });

    const outcome = await coordinator.dispatch("SUR-D71E8971");

    expect(outcome).toEqual({ status: "indeterminate", runId: "SUR-D71E8971" });
    expect(repo.markDispatchIndeterminate).toHaveBeenCalledWith(expect.objectContaining({
      runId: "SUR-D71E8971",
      reason: "admission-target-unavailable",
    }));
    expect(repo.failDispatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("fails closed when persisted admission fields no longer match the fingerprint", async () => {
    const repo = repository(record({
      requestedForce: true,
      admissionFingerprint: record().admissionFingerprint,
    }));
    const { coordinator, send } = service({ repository: repo });

    expect(await coordinator.dispatch("SUR-D71E8971")).toEqual({
      status: "failed",
      runId: "SUR-D71E8971",
    });
    expect(repo.failDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "admission-binding-drift" }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("reconciles an ambiguous row without creating a second admission", async () => {
    const repo = repository(record({ dispatchStatus: "indeterminate", dispatchAttemptCount: 1 }));
    const { coordinator, send } = service({ repository: repo });

    const result = await coordinator.reconcile();

    expect(result).toEqual({ attempted: 1, dispatched: 1, indeterminate: 0, failed: 0 });
    expect(repo.admit).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({ id: "self-upgrade:SUR-D71E8971" });
  });
});

describe("definite dispatch refusal classification", () => {
  it.each([400, 401, 403, 404, 406, 409, 412, 413])("classifies Inngest %s as definite", (status) => {
    expect(isDefiniteSelfUpgradeDispatchRefusal(new Error(`Inngest API Error: ${status} refused`))).toBe(true);
  });

  it.each([new Error("fetch failed"), new Error("Inngest API Error: 500 Internal server error")])(
    "keeps %s ambiguous",
    (error) => expect(isDefiniteSelfUpgradeDispatchRefusal(error)).toBe(false),
  );
});
