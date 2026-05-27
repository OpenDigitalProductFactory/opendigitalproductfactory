// apps/web/lib/queue/functions/contributor-inventory-sync.test.ts
// Phase 2 of BI-063BDF1B.
//
// Covers the pure `runContributorInventorySync` runner:
//   - happy path: all three sources return rows → status "completed",
//     snapshot rows inserted, run row + ScheduledJob heartbeat updated
//   - partial: one source fails → status "partial", other rows still
//     inserted, error recorded in perSourceResult
//   - failed: all sources fail → status "failed", no rows inserted,
//     heartbeat lastStatus="failed"
//   - stuck-run reaper: pre-existing running rows older than the
//     threshold are marked failed BEFORE the new run is created; on-demand
//     runs (reapStuckRuns: false) do NOT reap
//   - thrown reader: caught and recorded as a per-source error; does not
//     poison other sources

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  syncRunUpdateMany: vi.fn(),
  syncRunCreate: vi.fn(),
  syncRunUpdate: vi.fn(),
  snapshotCreateMany: vi.fn(),
  scheduledJobUpdate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    contributorInventorySyncRun: {
      updateMany: mocks.syncRunUpdateMany,
      create: mocks.syncRunCreate,
      update: mocks.syncRunUpdate,
    },
    contributorInventorySnapshot: {
      createMany: mocks.snapshotCreateMany,
    },
    scheduledJob: {
      update: mocks.scheduledJobUpdate,
    },
  },
}));

import { runContributorInventorySync, type SyncSourceReaders } from "./contributor-inventory-sync";

const FIXED_NOW = new Date("2026-05-26T20:00:00.000Z");

function fakeReaders(
  overrides: Partial<SyncSourceReaders> = {},
): SyncSourceReaders {
  const okWorktree = async () => ({
    ok: true as const,
    rows: [
      { sourceKey: "/repo/wt-a", payload: { path: "/repo/wt-a", branch: "feat/a" } },
      { sourceKey: "/repo/wt-b", payload: { path: "/repo/wt-b", branch: "feat/b" } },
    ],
  });
  const okBranch = async () => ({
    ok: true as const,
    rows: [{ sourceKey: "feat/a", payload: { name: "feat/a", remote: "origin" } }],
  });
  const okGithub = async () => ({
    ok: true as const,
    rows: [{ sourceKey: "1234", payload: { number: 1234, title: "feat: x" } }],
  });
  return {
    worktree: overrides.worktree ?? okWorktree,
    branch: overrides.branch ?? okBranch,
    githubPr: overrides.githubPr ?? okGithub,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.syncRunUpdateMany.mockResolvedValue({ count: 0 });
  mocks.syncRunCreate.mockImplementation(async ({ data }) => ({
    syncRunId: data.syncRunId,
  }));
  mocks.syncRunUpdate.mockResolvedValue({});
  mocks.snapshotCreateMany.mockImplementation(async ({ data }) => ({
    count: data.length,
  }));
  mocks.scheduledJobUpdate.mockResolvedValue({});
});

describe("runContributorInventorySync", () => {
  it("happy path: all three sources succeed → status completed, all rows inserted, heartbeat updated", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.status).toBe("completed");
    expect(result.insertedRows).toBe(4); // 2 worktrees + 1 branch + 1 PR
    expect(result.perSourceResult["git-worktree"].ok).toBe(true);
    expect(result.perSourceResult["git-branch"].ok).toBe(true);
    expect(result.perSourceResult["github-pr"].ok).toBe(true);

    expect(mocks.syncRunCreate).toHaveBeenCalledTimes(1);
    expect(mocks.snapshotCreateMany).toHaveBeenCalledTimes(3);
    expect(mocks.syncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed" }),
      }),
    );
    expect(mocks.scheduledJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastStatus: "completed",
          lastError: null,
        }),
      }),
    );
  });

  it("partial: GitHub fails → status partial, local rows still inserted, error recorded in perSourceResult", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders({
        githubPr: async () => ({ ok: false, error: "401 unauthorized" }),
      }),
    });

    expect(result.status).toBe("partial");
    expect(result.insertedRows).toBe(3); // worktree + branch, no PR rows
    expect(result.perSourceResult["github-pr"].ok).toBe(false);
    expect(result.perSourceResult["github-pr"].error).toBe("401 unauthorized");
    expect(result.perSourceResult["git-worktree"].ok).toBe(true);
    expect(result.perSourceResult["git-branch"].ok).toBe(true);
    // snapshotCreateMany called for the two successful sources only
    expect(mocks.snapshotCreateMany).toHaveBeenCalledTimes(2);
  });

  it("all sources fail → status failed, no rows inserted, heartbeat lastStatus=failed", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders({
        worktree: async () => ({ ok: false, error: "git not found" }),
        branch: async () => ({ ok: false, error: "git not found" }),
        githubPr: async () => ({ ok: false, error: "no credential", state: "not-configured" }),
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.insertedRows).toBe(0);
    expect(mocks.snapshotCreateMany).not.toHaveBeenCalled();
    expect(mocks.scheduledJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastStatus: "failed",
          lastError: expect.stringContaining("git not found"),
        }),
      }),
    );
  });

  it("preserves the not-configured state discriminator from the github reader", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders({
        githubPr: async () => ({
          ok: false,
          error: "no credential bound",
          state: "not-configured",
        }),
      }),
    });

    expect(result.perSourceResult["github-pr"].state).toBe("not-configured");
  });

  it("stuck-run reaper: when reapStuckRuns=true, marks pre-existing running rows older than the threshold as failed before the new run", async () => {
    mocks.syncRunUpdateMany.mockResolvedValue({ count: 2 });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      reapStuckRuns: true,
      readers: fakeReaders(),
    });

    expect(result.reaped).toBe(2);
    expect(mocks.syncRunUpdateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        startedAt: { lt: new Date(FIXED_NOW.getTime() - 20 * 60_000) },
      },
      data: { status: "failed", completedAt: FIXED_NOW },
    });
    // Reaper fires BEFORE the create
    const reapCallOrder = mocks.syncRunUpdateMany.mock.invocationCallOrder[0];
    const createCallOrder = mocks.syncRunCreate.mock.invocationCallOrder[0];
    expect(reapCallOrder).toBeLessThan(createCallOrder);
  });

  it("stuck-run reaper: when reapStuckRuns=false (on-demand), does NOT reap", async () => {
    await runContributorInventorySync({
      now: FIXED_NOW,
      reapStuckRuns: false,
      readers: fakeReaders(),
    });

    expect(mocks.syncRunUpdateMany).not.toHaveBeenCalled();
  });

  it("thrown reader: caught as a per-source error and does not poison other sources", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders({
        worktree: async () => {
          throw new Error("execFile timeout");
        },
      }),
    });

    expect(result.status).toBe("partial");
    expect(result.perSourceResult["git-worktree"].ok).toBe(false);
    expect(result.perSourceResult["git-worktree"].error).toBe("execFile timeout");
    expect(result.perSourceResult["git-branch"].ok).toBe(true);
    expect(result.perSourceResult["github-pr"].ok).toBe(true);
  });

  it("triggeredBy is propagated to the run row", async () => {
    await runContributorInventorySync({
      now: FIXED_NOW,
      triggeredBy: "ui",
      readers: fakeReaders(),
    });

    expect(mocks.syncRunCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ triggeredBy: "ui" }),
      select: { syncRunId: true },
    });
  });

  it("scheduledJob nextRunAt is set to now + 10 minutes", async () => {
    await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    const updateCall = mocks.scheduledJobUpdate.mock.calls[0]?.[0];
    expect(updateCall?.data.nextRunAt).toEqual(
      new Date(FIXED_NOW.getTime() + 10 * 60_000),
    );
  });
});
