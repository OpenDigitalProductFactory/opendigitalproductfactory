import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    backupRun: {
      findMany: (...a: unknown[]) => findManyMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
  },
}));

import { reconcileStuckBackupRuns } from "./reconcile-stuck-runs";

beforeEach(() => {
  findManyMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
});

describe("reconcileStuckBackupRuns", () => {
  it("fails a backup run stuck running past the window, scoped to never-finished old rows", async () => {
    const now = () => new Date("2026-06-14T02:00:00.000Z");
    findManyMock.mockResolvedValueOnce([
      { id: "BR-1", target: "postgres", startedAt: new Date("2026-06-14T00:00:00.000Z") },
    ]);

    const result = await reconcileStuckBackupRuns(
      { staleAfterMs: 45 * 60 * 1000, now },
      { log: vi.fn(), error: vi.fn() },
    );

    expect(result).toEqual({ failed: 1 });
    const where = findManyMock.mock.calls[0][0].where;
    expect(where.status).toBe("running");
    expect(where.finishedAt).toBeNull();
    expect(where.startedAt.lt.getTime()).toBe(now().getTime() - 45 * 60 * 1000);

    const update = updateMock.mock.calls[0][0];
    expect(update.where).toEqual({ id: "BR-1" });
    expect(update.data.status).toBe("failed");
    expect(update.data.finishedAt.getTime()).toBe(now().getTime());
    expect(update.data.errorMessage).toContain("stuck");
  });

  it("is a no-op when nothing is stuck", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const result = await reconcileStuckBackupRuns({}, { log: vi.fn(), error: vi.fn() });
    expect(result).toEqual({ failed: 0 });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("never throws (boot-path safety) — returns null on a DB error", async () => {
    findManyMock.mockRejectedValueOnce(new Error("db down"));
    const result = await reconcileStuckBackupRuns({}, { log: vi.fn(), error: vi.fn() });
    expect(result).toBeNull();
  });

  it("defaults the stale window to 45 minutes (past the longest backup timeout)", async () => {
    const now = () => new Date("2026-06-14T02:00:00.000Z");
    findManyMock.mockResolvedValueOnce([]);
    await reconcileStuckBackupRuns({ now }, { log: vi.fn(), error: vi.fn() });
    expect(findManyMock.mock.calls[0][0].where.startedAt.lt.getTime()).toBe(
      now().getTime() - 45 * 60 * 1000,
    );
  });
});
