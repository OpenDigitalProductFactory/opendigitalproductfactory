import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  executeRaw: vi.fn(), owner: vi.fn(), run: vi.fn(), update: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
    $executeRaw: db.executeRaw,
    platformConfig: { findUnique: db.owner },
    quiescenceRun: { findUnique: db.run, update: db.update },
  }) },
}));

import { enterReadyToSwap } from "./ready-to-swap-state";

const minute = 60_000;
const ready = new Date("2026-11-25T14:00:00.000Z");
const deadline = new Date(+ready + 125 * minute);
const pending = {
  trigger: "self-upgrade", triggerRefId: "SUR-fixture", status: "draining",
  enteredStateAt: { draining: new Date(+ready - minute).toISOString() },
  readyToSwapBudgetMs: 125 * minute, readyToSwapDeadlineAt: null, abortRequestedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  db.owner.mockResolvedValue({ value: { runId: "QR-fixture", level: "draining" } });
  db.run.mockResolvedValue(pending);
});

describe("write-once ready deadline", () => {
  it("commits status, ready time and deadline together and does not renew on replay after expiry", async () => {
    expect(await enterReadyToSwap("QR-fixture", "SUR-fixture", minute, () => ready)).toMatchObject({
      kind: "ready", deadline: deadline.toISOString(),
    });
    expect(db.update).toHaveBeenCalledExactlyOnceWith({
      where: { runId: "QR-fixture" },
      data: {
        status: "ready-to-swap",
        readyToSwapDeadlineAt: deadline,
        enteredStateAt: { ...pending.enteredStateAt, "ready-to-swap": ready.toISOString() },
        actualWaitMs: minute,
      },
    });
    expect(db.executeRaw).toHaveBeenCalledTimes(2);
    db.run.mockResolvedValue({ ...pending, status: "ready-to-swap", readyToSwapDeadlineAt: deadline });
    expect(await enterReadyToSwap("QR-fixture", "SUR-fixture", minute, () => new Date(+deadline + minute))).toMatchObject({
      kind: "ready", deadline: deadline.toISOString(),
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("does not write through an abort, an orphan, a terminal row or a different target", async () => {
    db.run.mockResolvedValueOnce({ ...pending, abortRequestedAt: ready, abortRequestedBy: "operator" });
    expect(await enterReadyToSwap("QR-fixture", "SUR-fixture", minute)).toEqual({ kind: "aborted", operator: "operator" });
    db.run.mockResolvedValueOnce({ ...pending, status: "failed", readyToSwapDeadlineAt: deadline });
    await expect(enterReadyToSwap("QR-fixture", "SUR-fixture", minute)).rejects.toThrow(/owns admission/);
    await expect(enterReadyToSwap("QR-fixture", "SUR-other", minute)).rejects.toThrow(/owns admission/);
    db.owner.mockResolvedValue({ value: { runId: "QR-other", level: "draining" } });
    await expect(enterReadyToSwap("QR-fixture", "SUR-fixture", minute)).rejects.toThrow(/owns admission/);
    expect(db.update).not.toHaveBeenCalled();
  });
});
