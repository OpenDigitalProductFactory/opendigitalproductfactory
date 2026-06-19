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
    featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
    buildActivity: { count: vi.fn().mockResolvedValue(0) },
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
});
