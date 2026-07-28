import { describe, expect, it, vi } from "vitest";

import {
  reconcileDataControlOperation,
  type DataControlRecoveryStore,
  type RecoverableDataControlOperation,
} from "./control-operation-runner";

function operation(
  overrides: Partial<RecoverableDataControlOperation> = {},
): RecoverableDataControlOperation {
  return {
    operationId: "DCO-1",
    organizationId: "org-1",
    actionKey: "data.subject.erase",
    status: "executing",
    governedCaseWorkItemId: null,
    steps: [
      {
        stepId: "DCOS-1",
        operationId: "DCO-1",
        targetKey: "qdrant",
        targetType: "qdrant",
        idempotencyKey: "DCO-1:qdrant",
        status: "executing",
        compensable: true,
        targetReceipt: null,
        leaseExpiresAt: new Date(0),
        nextRetryAt: null,
      },
    ],
    ...overrides,
  };
}

function store(initial: RecoverableDataControlOperation): DataControlRecoveryStore {
  let current = structuredClone(initial);
  const findStep = (stepId: string) => {
    const step = current.steps.find((candidate) => candidate.stepId === stepId);
    if (!step) throw new Error(`missing test step ${stepId}`);
    return step;
  };
  return {
    readOperation: vi.fn(async () => current),
    claimStep: vi.fn(async (stepId, input) => {
      const step = findStep(stepId);
      step.status = "executing";
      step.leaseExpiresAt = input.leaseExpiresAt;
      return { ...step };
    }),
    markApplied: vi.fn(async (stepId, receipt) => {
      const step = findStep(stepId);
      step.status = "applied";
      step.targetReceipt = receipt;
    }),
    markVerified: vi.fn(async (stepId) => {
      findStep(stepId).status = "verified";
    }),
    markFailed: vi.fn(async (stepId, failure) => {
      const step = findStep(stepId);
      step.status = "failed";
      step.nextRetryAt = failure.nextRetryAt;
    }),
    markCompensated: vi.fn(async (stepId) => {
      findStep(stepId).status = "compensated";
    }),
    transitionOperation: vi.fn(async (_operationId, _from, to) => {
      current.status = to;
      return true;
    }),
    ensureGovernedCase: vi.fn(async () => "WI-DCO-1"),
    writeTerminalEvidence: vi.fn(async () => undefined),
  };
}

describe("data control operation recovery", () => {
  it("verifies an expired executing step before replaying its external effect", async () => {
    const db = store(operation());
    const effect = vi.fn();
    const verify = vi.fn(async () => ({ verified: true, evidence: { absent: true } }));

    const result = await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: { qdrant: { effect, verify } },
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(effect).not.toHaveBeenCalled();
    expect(db.markApplied).toHaveBeenCalledWith("DCOS-1", null);
    expect(db.markVerified).toHaveBeenCalledWith("DCOS-1", { absent: true });
    expect(result.status).toBe("reconciled");
    expect(db.writeTerminalEvidence).toHaveBeenCalledTimes(1);
  });

  it("passes the stable idempotency key when verification cannot prove an effect", async () => {
    const db = store(operation());
    const effect = vi.fn(async () => ({ accepted: true }));
    const verify = vi
      .fn()
      .mockResolvedValueOnce({ verified: false, evidence: null })
      .mockResolvedValueOnce({ verified: true, evidence: { absent: true } });

    await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: { qdrant: { effect, verify } },
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(effect).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "DCO-1:qdrant",
    }));
    expect(db.markApplied).toHaveBeenCalledWith("DCOS-1", { accepted: true });
  });

  it("opens one governed case and never emits terminal evidence for a non-compensable partial", async () => {
    const failed = operation({
      steps: [
        {
          ...operation().steps[0]!,
          targetKey: "postgres",
          targetType: "postgres",
          status: "failed",
          compensable: false,
        },
        {
          ...operation().steps[0]!,
          stepId: "DCOS-2",
          targetKey: "qdrant",
          status: "verified",
        },
      ],
    });
    const db = store(failed);

    const result = await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: {},
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(result.status).toBe("partially-complete");
    expect(db.ensureGovernedCase).toHaveBeenCalledTimes(1);
    expect(db.writeTerminalEvidence).not.toHaveBeenCalled();
  });

  it("compensates a previously verified effect without replaying it", async () => {
    const compensating = operation({
      status: "compensating",
      steps: [
        {
          ...operation().steps[0]!,
          status: "verified",
          targetReceipt: { deletionId: "delete-1" },
        },
      ],
    });
    const db = store(compensating);
    const effect = vi.fn();
    const compensate = vi.fn(async () => ({ restored: true }));

    const result = await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: {
        qdrant: {
          effect,
          verify: vi.fn(),
          compensate,
        },
      },
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(effect).not.toHaveBeenCalled();
    expect(compensate).toHaveBeenCalledWith(expect.objectContaining({
      status: "executing",
      targetReceipt: { deletionId: "delete-1" },
    }));
    expect(db.markCompensated).toHaveBeenCalledWith(
      "DCOS-1",
      { restored: true },
    );
    expect(result.status).toBe("compensated");
    expect(db.writeTerminalEvidence).toHaveBeenCalledTimes(1);
  });

  it("keeps retryable compensation in progress when its adapter is unavailable", async () => {
    const compensating = operation({
      status: "compensating",
      steps: [{ ...operation().steps[0]!, status: "verified" }],
    });
    const db = store(compensating);

    const result = await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: {},
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(result).toEqual({
      status: "compensating",
      blockedTargets: ["qdrant"],
    });
    expect(db.transitionOperation).not.toHaveBeenCalled();
    expect(db.ensureGovernedCase).not.toHaveBeenCalled();
  });

  it("keeps an effect failure recoverable while a retry is scheduled", async () => {
    const db = store(operation());
    const result = await reconcileDataControlOperation({
      operationId: "DCO-1",
      workerId: "worker-1",
      store: db,
      adapters: {
        qdrant: {
          effect: vi.fn(async () => {
            throw new Error("target unavailable");
          }),
          verify: vi.fn(async () => ({ verified: false, evidence: null })),
        },
      },
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(db.markFailed).toHaveBeenCalledWith(
      "DCOS-1",
      expect.objectContaining({
        errorClass: "Error",
        nextRetryAt: new Date("2026-07-27T00:01:00Z"),
      }),
    );
    expect(result.status).toBe("executing");
    expect(db.writeTerminalEvidence).not.toHaveBeenCalled();
  });
});
