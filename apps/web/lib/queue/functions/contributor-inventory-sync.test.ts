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
  syncRunFindFirst: vi.fn(),
  syncRunFindMany: vi.fn(),
  syncRunDeleteMany: vi.fn(),
  snapshotCreateMany: vi.fn(),
  scheduledJobUpsert: vi.fn(),
  scheduledJobFindUnique: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationCreate: vi.fn(),
  notificationUpdateMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    contributorInventorySyncRun: {
      updateMany: mocks.syncRunUpdateMany,
      create: mocks.syncRunCreate,
      update: mocks.syncRunUpdate,
      findFirst: mocks.syncRunFindFirst,
      findMany: mocks.syncRunFindMany,
      deleteMany: mocks.syncRunDeleteMany,
    },
    contributorInventorySnapshot: {
      createMany: mocks.snapshotCreateMany,
    },
    scheduledJob: {
      upsert: mocks.scheduledJobUpsert,
      findUnique: mocks.scheduledJobFindUnique,
    },
    platformNotification: {
      findFirst: mocks.notificationFindFirst,
      create: mocks.notificationCreate,
      updateMany: mocks.notificationUpdateMany,
    },
  },
  // Constants the runner imports from the @dpf/db barrel — the seed module
  // re-exports them and the runner uses them to populate the upsert create
  // branch. Mirror them here so the mocked module surface matches the real
  // one. Values must match packages/db/src/seed-contributor-inventory.ts.
  CONTRIBUTOR_INVENTORY_JOB_ID: "contributor-inventory-sync",
  CONTRIBUTOR_INVENTORY_JOB_NAME: "Contributor inventory sync (platform-managed)",
  CONTRIBUTOR_INVENTORY_SCHEDULE: "every-10-minutes",
}));

import {
  resolveContributorInventoryGitCwd,
  runContributorInventorySync,
  type SyncSourceReaders,
} from "./contributor-inventory-sync";

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
  mocks.scheduledJobUpsert.mockResolvedValue({});
  // Phase 6 — sane defaults so the heartbeat-only tests don't have to
  // arrange the retention / notification mocks.
  mocks.scheduledJobFindUnique.mockResolvedValue({ lastRunAt: null });
  mocks.syncRunFindFirst.mockResolvedValue(null); // no successful runs yet
  mocks.syncRunFindMany.mockResolvedValue([]);
  mocks.syncRunDeleteMany.mockResolvedValue({ count: 0 });
  mocks.notificationFindFirst.mockResolvedValue(null);
  mocks.notificationCreate.mockResolvedValue({});
  mocks.notificationUpdateMany.mockResolvedValue({ count: 0 });
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
    expect(mocks.scheduledJobUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: "contributor-inventory-sync" },
        create: expect.objectContaining({
          jobId: "contributor-inventory-sync",
          name: "Contributor inventory sync (platform-managed)",
          schedule: "every-10-minutes",
          lastStatus: "completed",
          lastError: null,
        }),
        update: expect.objectContaining({
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
    expect(mocks.scheduledJobUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          lastStatus: "failed",
          lastError: expect.stringContaining("git not found"),
        }),
        create: expect.objectContaining({
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

  it("records a provider not-modified response so consumers can renew prior observations", async () => {
    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders({
        githubPr: async () => ({ ok: true, rows: [], unchanged: true }),
      }),
    });

    expect(result.perSourceResult["github-pr"]).toMatchObject({
      ok: true,
      count: 0,
      unchanged: true,
    });
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

    const upsertCall = mocks.scheduledJobUpsert.mock.calls[0]?.[0];
    const expectedNextRunAt = new Date(FIXED_NOW.getTime() + 10 * 60_000);
    expect(upsertCall?.update.nextRunAt).toEqual(expectedNextRunAt);
    expect(upsertCall?.create.nextRunAt).toEqual(expectedNextRunAt);
  });

  it("heartbeat is created if missing — upsert path populates create branch with seed-derived name + schedule", async () => {
    // The seed helper (packages/db/src/seed-contributor-inventory.ts) is the
    // only writer of the heartbeat row's jobId/name/schedule on fresh installs.
    // On upgrade installs where `pnpm db seed` doesn't re-run, the row never
    // gets created and the first cron tick used to throw P2025. The runner
    // now uses upsert; this case locks in that the create branch carries the
    // exact name + schedule strings the seed helper would have written, so
    // the heartbeat row a missing-seed install ends up with is identical to
    // a seeded one.
    await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(mocks.scheduledJobUpsert).toHaveBeenCalledTimes(1);
    const upsertCall = mocks.scheduledJobUpsert.mock.calls[0]?.[0];
    expect(upsertCall?.where).toEqual({ jobId: "contributor-inventory-sync" });
    expect(upsertCall?.create).toEqual({
      jobId: "contributor-inventory-sync",
      name: "Contributor inventory sync (platform-managed)",
      schedule: "every-10-minutes",
      lastRunAt: FIXED_NOW,
      lastStatus: "completed",
      lastError: null,
      nextRunAt: new Date(FIXED_NOW.getTime() + 10 * 60_000),
    });
  });
});

describe("resolveContributorInventoryGitCwd", () => {
  it("prefers DPF_REPO_ROOT so portal inventory commands run against the mounted host clone", () => {
    expect(
      resolveContributorInventoryGitCwd({
        env: { DPF_REPO_ROOT: "/host-dpf" },
        cwd: "/app",
      }),
    ).toBe("/host-dpf");
  });

  it("falls back to process cwd when DPF_REPO_ROOT is not configured", () => {
    expect(
      resolveContributorInventoryGitCwd({
        env: {},
        cwd: "/app",
      }),
    ).toBe("/app");
  });
});

// ─── Phase 6 — retention sweep + PlatformNotification writes ────────────────

describe("runContributorInventorySync — Phase 6 retention sweep", () => {
  it("preserves the latest-successful run per source via syncRunId notIn, regardless of age", async () => {
    mocks.syncRunFindFirst.mockImplementation(async ({ where }) => {
      const path = (where.perSourceResult.path as string[])[0];
      if (path === "git-worktree") return { syncRunId: "civs-wt-keep" };
      if (path === "git-branch") return { syncRunId: "civs-br-keep" };
      if (path === "github-pr") return { syncRunId: "civs-gh-keep" };
      return null;
    });
    mocks.syncRunDeleteMany.mockResolvedValue({ count: 5 });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.cleanupDeletedRuns).toBe(5);

    const deleteCall = mocks.syncRunDeleteMany.mock.calls[0]?.[0];
    expect(deleteCall?.where.startedAt.lt).toEqual(
      new Date(FIXED_NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
    );
    const notIn = deleteCall?.where.syncRunId.notIn as string[];
    expect(notIn.sort()).toEqual(["civs-br-keep", "civs-gh-keep", "civs-wt-keep"]);
  });

  it("retention sweep failure is caught and logged; the run still returns ok", async () => {
    mocks.syncRunFindFirst.mockResolvedValue(null);
    mocks.syncRunDeleteMany.mockRejectedValue(new Error("connection lost"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.status).toBe("completed");
    expect(result.cleanupDeletedRuns).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("retention sweep failed"),
      "connection lost",
    );
    warnSpy.mockRestore();
  });
});

describe("runContributorInventorySync — Phase 6 GitHub failure notification", () => {
  function recentRuns(failures: number, total = 6) {
    // Returns `total` rows; the first `failures` are failed, the rest succeeded.
    const rows = [];
    for (let i = 0; i < total; i++) {
      rows.push({
        perSourceResult: {
          "github-pr": {
            ok: i >= failures,
            state: i >= failures ? "ok" : "error",
          },
        },
      });
    }
    return rows;
  }

  it("fires a warning when GitHub failed in all 6 most-recent runs and no notification exists", async () => {
    mocks.syncRunFindMany.mockResolvedValue(recentRuns(6));
    mocks.notificationFindFirst.mockResolvedValue(null);

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: "warning",
          category: "contributor-inventory-github",
          subjectId: "github-pr-sync",
          message: expect.stringContaining("Contributor MCP card"),
        }),
      }),
    );
  });

  it("is idempotent: does not duplicate an existing open warning at the same severity", async () => {
    mocks.syncRunFindMany.mockResolvedValue(recentRuns(6));
    mocks.notificationFindFirst.mockResolvedValueOnce({
      id: "pn-1",
      severity: "warning",
    });
    // Stale-cron notification path still null:
    mocks.notificationFindFirst.mockResolvedValueOnce(null);

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsCreated).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("resolves the open notification when at least one of the most recent 6 runs succeeded", async () => {
    mocks.syncRunFindMany.mockResolvedValue(recentRuns(5, 6)); // 5 failed, 1 succeeded
    mocks.notificationFindFirst.mockResolvedValueOnce({
      id: "pn-1",
      severity: "warning",
    });
    mocks.notificationFindFirst.mockResolvedValueOnce(null);
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsResolved).toBeGreaterThanOrEqual(1);
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: "contributor-inventory-github",
          resolvedAt: null,
        }),
        data: { resolvedAt: FIXED_NOW },
      }),
    );
  });

  it("does NOT fire when GitHub is not-configured (no credential bound) across the recent runs", async () => {
    mocks.syncRunFindMany.mockResolvedValue(
      Array.from({ length: 6 }, () => ({
        perSourceResult: {
          "github-pr": { ok: false, state: "not-configured" },
        },
      })),
    );
    mocks.notificationFindFirst.mockResolvedValue(null);

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsCreated).toBe(0);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("does NOT fire when fewer than 6 historical runs exist (cold-start window)", async () => {
    mocks.syncRunFindMany.mockResolvedValue(
      Array.from({ length: 3 }, () => ({
        perSourceResult: { "github-pr": { ok: false } },
      })),
    );

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsCreated).toBe(0);
  });
});

describe("runContributorInventorySync — Phase 6 stale-cron notification", () => {
  it("fires a critical notification when the prior lastRunAt is >2h old (resumed-after-gap)", async () => {
    const priorLastRunAt = new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000); // 3h ago
    mocks.scheduledJobFindUnique.mockResolvedValue({ lastRunAt: priorLastRunAt });
    mocks.notificationFindFirst.mockResolvedValue(null);

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsCreated).toBeGreaterThanOrEqual(1);
    expect(mocks.notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          severity: "critical",
          category: "contributor-inventory-cron",
          subjectId: "contributor-inventory-sync",
          message: expect.stringContaining("180-minute gap"),
        }),
      }),
    );
  });

  it("does NOT fire when prior lastRunAt is within 2h (normal cadence)", async () => {
    const priorLastRunAt = new Date(FIXED_NOW.getTime() - 15 * 60 * 1000); // 15min ago
    mocks.scheduledJobFindUnique.mockResolvedValue({ lastRunAt: priorLastRunAt });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(mocks.notificationCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "contributor-inventory-cron",
        }),
      }),
    );
    expect(result.notificationsCreated).toBe(0);
  });

  it("does NOT fire on a fresh install where lastRunAt is null", async () => {
    mocks.scheduledJobFindUnique.mockResolvedValue({ lastRunAt: null });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(mocks.notificationCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "contributor-inventory-cron",
        }),
      }),
    );
    expect(result.notificationsCreated).toBe(0);
  });

  it("resolves an open stale-cron notification once the gap closes (lastRunAt is now recent)", async () => {
    const priorLastRunAt = new Date(FIXED_NOW.getTime() - 5 * 60 * 1000); // 5min ago — recent
    mocks.scheduledJobFindUnique.mockResolvedValue({ lastRunAt: priorLastRunAt });
    // syncRunFindMany returns empty by default — the github branch
    // short-circuits without calling notificationFindFirst at all, so the
    // stale-cron branch is the only consumer of the mock.
    mocks.notificationFindFirst.mockResolvedValue({
      id: "pn-cron-1",
      severity: "critical",
    });
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });

    const result = await runContributorInventorySync({
      now: FIXED_NOW,
      readers: fakeReaders(),
    });

    expect(result.notificationsResolved).toBeGreaterThanOrEqual(1);
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: "contributor-inventory-cron",
          resolvedAt: null,
        }),
      }),
    );
  });
});
