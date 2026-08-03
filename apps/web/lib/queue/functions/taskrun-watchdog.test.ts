import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the lazy + module imports the watchdog touches.
const quiescenceFindManyMock = vi.fn();
const transitionStateMock = vi.fn();
const setQuiescenceLevelMock = vi.fn();
const inngestSendMock = vi.fn();
const isStallWatchdogEnabledMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    quiescenceRun: { findMany: (...a: unknown[]) => quiescenceFindManyMock(...a) },
    // Reached only past the flag check; default-empty so the handler short-circuits.
    buildStudioStallThreshold: { findMany: vi.fn().mockResolvedValue([]) },
    taskRun: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    // BI-8F45BA74 inert-build reaper runs every tick before the flag check;
    // no candidates → no-op (returns 0).
    featureBuild: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    buildActivity: { count: vi.fn().mockResolvedValue(0) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn().mockImplementation(async (cb) => {
      // Mock the transaction object
      const tx = {
        taskRun: { update: vi.fn() },
        stallEvent: { create: vi.fn() },
        buildActivity: { create: vi.fn() },
        featureBuild: { update: vi.fn() },
        notification: {
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      return await cb(tx);
    }),
  },
}));
vi.mock("@/lib/self-upgrade/quiescence", () => ({
  transitionState: (...a: unknown[]) => transitionStateMock(...a),
  setQuiescenceLevel: (...a: unknown[]) => setQuiescenceLevelMock(...a),
}));
vi.mock("../inngest-client", () => ({
  inngest: {
    // The module calls inngest.createFunction(config, handler) at import; expose
    // the raw handler as `.fn` so the test can invoke it directly.
    createFunction: (_config: unknown, fn: unknown) => ({ fn }),
    send: (...a: unknown[]) => inngestSendMock(...a),
  },
}));
vi.mock("@/lib/shared/feature-flags", () => ({
  isStallWatchdogEnabled: (...a: unknown[]) => isStallWatchdogEnabledMock(...a),
}));

import {
  recoverStuckQuiescenceCoordinators,
  isStuckQuiescingTaskRun,
  STUCK_QUIESCING_TASKRUN_MS,
  taskrunWatchdog,
} from "./taskrun-watchdog";

const stuck = (runId: string, status = "ready-to-swap") => ({
  runId,
  status,
  lastHeartbeatAt: null,
  startedAt: new Date("2026-06-10T00:00:00.000Z"),
});

beforeEach(() => {
  quiescenceFindManyMock.mockReset();
  transitionStateMock.mockReset().mockResolvedValue(undefined);
  setQuiescenceLevelMock.mockReset().mockResolvedValue(undefined);
  inngestSendMock.mockReset().mockResolvedValue(undefined);
  isStallWatchdogEnabledMock.mockReset().mockResolvedValue(true);
});

describe("isStuckQuiescingTaskRun (BI-8F45BA74)", () => {
  const now = new Date("2026-06-19T19:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const T = STUCK_QUIESCING_TASKRUN_MS;

  it("reaps a row flipped to quiescing long ago whose loop never came back", () => {
    expect(
      isStuckQuiescingTaskRun({ quiescedAt: ago(T + 60_000), lastHeartbeatAt: null, now, thresholdMs: T }),
    ).toBe(true);
  });

  it("does NOT reap a row that was just flipped (loop is about to cooperatively exit)", () => {
    expect(
      isStuckQuiescingTaskRun({ quiescedAt: ago(60_000), lastHeartbeatAt: null, now, thresholdMs: T }),
    ).toBe(false);
  });

  it("does NOT reap when a heartbeat arrived after the flip (loop is alive, mid-exit)", () => {
    // quiescedAt is old, but a recent heartbeat means the loop is still running.
    expect(
      isStuckQuiescingTaskRun({ quiescedAt: ago(T + 60_000), lastHeartbeatAt: ago(30_000), now, thresholdMs: T }),
    ).toBe(false);
  });

  it("does NOT guess when there is no signal at all", () => {
    expect(
      isStuckQuiescingTaskRun({ quiescedAt: null, lastHeartbeatAt: null, now, thresholdMs: T }),
    ).toBe(false);
  });

  it("requires strictly older than the window (exactly at the threshold is not reaped)", () => {
    expect(
      isStuckQuiescingTaskRun({ quiescedAt: ago(T), lastHeartbeatAt: null, now, thresholdMs: T }),
    ).toBe(false);
  });

  it("uses a conservative window (>= the dead-phase liveness window)", () => {
    expect(STUCK_QUIESCING_TASKRUN_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

describe("recoverStuckQuiescenceCoordinators", () => {
  it("reaps a stuck coordinator: fails it, resets the level, clears the queue", async () => {
    quiescenceFindManyMock.mockResolvedValueOnce([stuck("QR-1")]);

    const recovered = await recoverStuckQuiescenceCoordinators(
      new Date("2026-06-14T00:00:00.000Z"),
    );

    expect(recovered).toBe(1);
    expect(transitionStateMock).toHaveBeenCalledWith(
      "QR-1",
      "failed",
      expect.objectContaining({ outcome: "failed", completionSource: "watchdog" }),
    );
    expect(setQuiescenceLevelMock).toHaveBeenCalledWith("normal", null);
    expect(inngestSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "platform.quiescence-cleared",
        data: expect.objectContaining({ runId: "QR-1", reason: "watchdog-reaped" }),
      }),
    );
  });

  it("is a no-op when no coordinator is stuck", async () => {
    quiescenceFindManyMock.mockResolvedValueOnce([]);
    const recovered = await recoverStuckQuiescenceCoordinators(new Date());
    expect(recovered).toBe(0);
    expect(transitionStateMock).not.toHaveBeenCalled();
    expect(setQuiescenceLevelMock).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("is best-effort: a single failure doesn't abort the rest", async () => {
    quiescenceFindManyMock.mockResolvedValueOnce([stuck("QR-bad"), stuck("QR-ok")]);
    transitionStateMock
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValue(undefined);

    const recovered = await recoverStuckQuiescenceCoordinators(new Date());

    expect(recovered).toBe(1); // QR-ok still reaped
    expect(setQuiescenceLevelMock).toHaveBeenCalledTimes(1);
  });

  it("uses a 2-minute stale cutoff (stale heartbeat OR null + old start)", async () => {
    quiescenceFindManyMock.mockResolvedValueOnce([]);
    const now = new Date("2026-06-14T00:10:00.000Z");
    await recoverStuckQuiescenceCoordinators(now);
    const where = quiescenceFindManyMock.mock.calls[0][0].where;
    expect(where.status.notIn).toContain("completed");
    expect(where.OR[0].lastHeartbeatAt.lt.getTime()).toBe(now.getTime() - 2 * 60 * 1000);
  });

  it("does NOT reap ready-to-swap / swapping — those park by design during the promoter build", async () => {
    // Regression (BI-QUIESCE-READY-REAP): at ready-to-swap the coordinator stops
    // heartbeating while the caller runs a multi-minute docker build, so the 2-min
    // reaper must exclude the caller-owned states (bounded by the 60-min waitForEvent
    // timeout instead). Excluding them at the query level is what prevents the reap.
    quiescenceFindManyMock.mockResolvedValueOnce([]);
    await recoverStuckQuiescenceCoordinators(new Date("2026-06-14T00:10:00.000Z"));
    const notIn = quiescenceFindManyMock.mock.calls[0][0].where.status.notIn;
    expect(notIn).toContain("ready-to-swap");
    expect(notIn).toContain("swapping");
    // still reaps the crashed drain phases
    expect(notIn).not.toContain("draining");
    expect(notIn).not.toContain("preparing");
    expect(notIn).not.toContain("pending");
  });
});

describe("taskrunWatchdog handler (the early-return fix)", () => {
  it("runs quiescence recovery even when the stall watchdog is flag-off", async () => {
    isStallWatchdogEnabledMock.mockResolvedValueOnce(false);
    quiescenceFindManyMock.mockResolvedValueOnce([stuck("QR-1", "draining")]);

    // Invoke the raw handler exposed by the mocked createFunction.
    const result = await (taskrunWatchdog as unknown as { fn: () => Promise<unknown> }).fn();

    // It short-circuits on flag-off, but ONLY after reaping the stuck coordinator.
    expect(result).toMatchObject({
      skipped: true,
      reason: "flag-off",
      quiescenceRecovered: 1,
    });
    expect(transitionStateMock).toHaveBeenCalledWith("QR-1", "failed", expect.any(Object));
    expect(setQuiescenceLevelMock).toHaveBeenCalledWith("normal", null);
  });

  it("BI-15B42AFE: dedupes taskrun.stalled notification when an unread one already exists", async () => {
    isStallWatchdogEnabledMock.mockResolvedValueOnce(true);
    // 1. Mock threshold to allow candidates to process
    const { prisma } = await import("@dpf/db");
    const tMock = vi.mocked(prisma.buildStudioStallThreshold.findMany);
    tMock.mockResolvedValueOnce([{ scope: "default", heartbeatTimeoutSeconds: 300, totalPhaseTimeoutSeconds: 1800 } as any]);

    // 2. Mock a stall candidate
    const queryMock = vi.mocked(prisma.$queryRaw);
    queryMock.mockResolvedValueOnce([
      { taskRunId: "TR-1", buildId: "B-1", phase: "build", startedAt: new Date(), lastHeartbeatAt: null, source: "build" },
    ]);

    // 3. Mock resolution to owner
    const taskRunMock = vi.mocked(prisma.taskRun.findMany);
    taskRunMock.mockResolvedValueOnce([{ id: "cuid1", taskRunId: "TR-1", userId: "owner-1" } as any]);
    const featureBuildMock = vi.mocked(prisma.featureBuild.findUnique);
    featureBuildMock.mockResolvedValueOnce({ createdById: "owner-1", buildExecState: {}, verificationOut: {} } as any);

    // 4. Mock the transaction callback capture
    const txMock = vi.mocked(prisma.$transaction);
    const existingNotification = { id: "notif-1" };
    let capturedTx: any;
    txMock.mockImplementationOnce(async (cb: any) => {
      capturedTx = {
        taskRun: { update: vi.fn() },
        stallEvent: { create: vi.fn() },
        buildActivity: { create: vi.fn() },
        featureBuild: { update: vi.fn() },
        notification: {
          findFirst: vi.fn().mockResolvedValue(existingNotification), // Exists as unread!
          update: vi.fn(),
          create: vi.fn(),
        },
      };
      return await cb(capturedTx);
    });

    const result = await (taskrunWatchdog as unknown as { fn: () => Promise<unknown> }).fn();

    expect(result).toMatchObject({ processed: 1 });
    expect(capturedTx.notification.findFirst).toHaveBeenCalledWith({
      where: { userId: "owner-1", type: "taskrun.stalled", read: false },
      select: { id: true },
    });
    // Should update existing, NOT create a new one
    expect(capturedTx.notification.update).toHaveBeenCalled();
    expect(capturedTx.notification.create).not.toHaveBeenCalled();
  });
});
