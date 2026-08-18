// apps/web/lib/contributor-change-lanes/read-model.test.ts
// Phase 3 rewrite for BI-063BDF1B — DB-only read model.
//
// Verifies latest-successful-per-source semantics, five-state freshness
// discriminator (ok / stale / error / not-configured / warming-up), and the
// cold-start affordances (anySourceWarmingUp + anySnapshotSourceDegraded).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadContributorChangeLaneReadModel } from "./read-model";

const NOW = new Date("2026-05-26T22:00:00.000Z");
const RECENT = new Date("2026-05-26T21:58:00.000Z"); // 2 min ago — fresh
const STALE = new Date("2026-05-26T21:30:00.000Z"); // 30 min ago — past 20-min threshold

function makeDb() {
  return {
    workroom: { findMany: vi.fn() },
    runtimeTarget: { findMany: vi.fn() },
    runtimeVerification: { findMany: vi.fn() },
    nonProductionEnvironmentLease: { findMany: vi.fn() },
    contributorInventorySyncRun: { findFirst: vi.fn() },
    credentialEntry: { findFirst: vi.fn() },
  };
}

type DbHarness = ReturnType<typeof makeDb>;
function dbAsAny(db: DbHarness): any {
  return db;
}

function syncRunRow(opts: {
  syncRunId: string;
  completedAt: Date;
  snapshots: { payload: unknown }[];
}) {
  return {
    syncRunId: opts.syncRunId,
    startedAt: new Date(opts.completedAt.getTime() - 1_000),
    completedAt: opts.completedAt,
    status: "completed",
    perSourceResult: {},
    snapshots: opts.snapshots,
  };
}

beforeEach(() => {});

describe("loadContributorChangeLaneReadModel — Phase 3", () => {
  let db: DbHarness;

  beforeEach(() => {
    db = makeDb();
    db.workroom.findMany.mockResolvedValue([]);
    db.runtimeTarget.findMany.mockResolvedValue([]);
    db.runtimeVerification.findMany.mockResolvedValue([]);
    db.nonProductionEnvironmentLease.findMany.mockResolvedValue([]);
    // Default: no successful run for any snapshot source → warming-up.
    db.contributorInventorySyncRun.findFirst.mockResolvedValue(null);
    // Default: no GitHub credential bound → github-pr is not-configured.
    db.credentialEntry.findFirst.mockResolvedValue(null);
  });

  it("warming-up: no successful run yet for any snapshot source, no GitHub credential bound", async () => {
    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    expect(result.lanes).toEqual([]);
    expect(result.anySourceWarmingUp).toBe(true);
    expect(result.anySnapshotSourceDegraded).toBe(true);

    const byName = new Map(result.freshness.map((f) => [f.source, f]));
    expect(byName.get("git-worktree")?.state).toBe("warming-up");
    expect(byName.get("git-branch")?.state).toBe("warming-up");
    // No credential → github-pr is "not-configured", not "warming-up".
    expect(byName.get("github-pr")?.state).toBe("not-configured");
    expect(byName.get("github-pr")?.message).toContain("Contributor MCP card");
  });

  it("maps Work Capsule scope fields into projected lanes", async () => {
    db.workroom.findMany.mockResolvedValue([
      {
        capsuleId: "WC-SCOPED",
        title: "Customer onboarding",
        status: "working",
        executorKind: "codex-desktop",
        executorRef: null,
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        servedPersona: "customer",
        activityKind: "delivery",
        outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
        headBranch: "feat/customer-onboarding",
        headSha: "abc",
        worktreePath: "D:/DPF-customer-onboarding",
        pullRequestUrl: null,
        backlogItemId: null,
        featureBuildId: null,
        leaseHolderPrincipalId: "principal-1",
        leaseExpiresAt: new Date(NOW.getTime() + 60_000),
        updatedAt: RECENT,
        objective: "Coordinate customer onboarding.",
      },
    ]);

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        decisionScope: true,
        portfolioRole: true,
        servedPersona: true,
        activityKind: true,
        outcomeAnchor: true,
      }),
    }));
    expect(result.lanes).toEqual([
      expect.objectContaining({
        workCapsuleId: "WC-SCOPED",
        decisionScope: "wwwd",
        portfolioRole: "productsAndServicesSold",
        servedPersona: "customer",
        activityKind: "delivery",
        outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
      }),
    ]);
  });

  it("ok: each source resolves to its latest-successful row independently", async () => {
    const worktreePayload = {
      path: "/repo/wt-a",
      branch: "feat/a",
      headSha: "abc",
      isRegistered: true,
    };
    const branchPayload = {
      name: "feat/a",
      headSha: "abc",
      remote: "origin",
      isMerged: false,
      lastCommitAt: null,
    };
    const prPayload = {
      number: 42,
      url: "https://github.com/o/r/pull/42",
      title: "feat: a",
      headBranch: "feat/a",
      state: "open",
      isDraft: false,
      mergeStateStatus: "CLEAN",
    };

    db.contributorInventorySyncRun.findFirst.mockImplementation(async ({ where }) => {
      const path = (where.perSourceResult.path as string[])[0];
      if (path === "git-worktree") {
        return syncRunRow({
          syncRunId: "run-a",
          completedAt: RECENT,
          snapshots: [{ payload: worktreePayload }],
        });
      }
      if (path === "git-branch") {
        return syncRunRow({
          syncRunId: "run-a",
          completedAt: RECENT,
          snapshots: [{ payload: branchPayload }],
        });
      }
      if (path === "github-pr") {
        return syncRunRow({
          syncRunId: "run-a",
          completedAt: RECENT,
          snapshots: [{ payload: prPayload }],
        });
      }
      return null;
    });
    db.credentialEntry.findFirst.mockResolvedValue({ id: "cred-1" });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    expect(result.anySourceWarmingUp).toBe(false);
    expect(result.anySnapshotSourceDegraded).toBe(false);
    const byName = new Map(result.freshness.map((f) => [f.source, f]));
    expect(byName.get("git-worktree")?.state).toBe("ok");
    expect(byName.get("git-worktree")?.count).toBe(1);
    expect(byName.get("git-branch")?.state).toBe("ok");
    expect(byName.get("github-pr")?.state).toBe("ok");
  });

  it("latest-successful-per-source: GitHub failed in newest run but had succeeded in an older run → the older row drives the projection (the resolver is queried per source, not globally)", async () => {
    const worktreePayload = { path: "/wt", branch: null, headSha: null, isRegistered: true };
    const branchPayload = {
      name: "main",
      headSha: "z",
      remote: "origin",
      isMerged: false,
      lastCommitAt: null,
    };
    const olderPrPayload = {
      number: 7,
      url: "https://example.com/pr/7",
      title: "PR 7",
      headBranch: "main",
      state: "open",
      isDraft: false,
      mergeStateStatus: null,
    };

    db.contributorInventorySyncRun.findFirst.mockImplementation(async ({ where }) => {
      const source = (where.perSourceResult.path as string[])[0];
      // Each source returns ITS latest-successful row. The runner's actual
      // SQL uses `orderBy startedAt DESC` against the `ok: true` filter so
      // this test models that contract: when GitHub failed in the newest
      // run, the resolver still returns the OLDER successful GitHub run.
      if (source === "git-worktree") {
        return syncRunRow({
          syncRunId: "run-new",
          completedAt: RECENT,
          snapshots: [{ payload: worktreePayload }],
        });
      }
      if (source === "git-branch") {
        return syncRunRow({
          syncRunId: "run-new",
          completedAt: RECENT,
          snapshots: [{ payload: branchPayload }],
        });
      }
      if (source === "github-pr") {
        return syncRunRow({
          syncRunId: "run-old",
          completedAt: RECENT,
          snapshots: [{ payload: olderPrPayload }],
        });
      }
      return null;
    });
    db.credentialEntry.findFirst.mockResolvedValue({ id: "cred-1" });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    expect(result.anySourceWarmingUp).toBe(false);
    const byName = new Map(result.freshness.map((f) => [f.source, f]));
    // All three sources resolve to "ok" — older GitHub data is the
    // latest-successful for that source even though it's a different run.
    expect(byName.get("github-pr")?.state).toBe("ok");
    expect(byName.get("github-pr")?.count).toBe(1);
  });

  it("stale: latest-successful run older than 20-minute threshold → state stale, anySnapshotSourceDegraded true", async () => {
    db.contributorInventorySyncRun.findFirst.mockResolvedValue(
      syncRunRow({
        syncRunId: "run-stale",
        completedAt: STALE,
        snapshots: [
          {
            payload: {
              path: "/repo/wt",
              branch: null,
              headSha: null,
              isRegistered: true,
            },
          },
        ],
      }),
    );
    db.credentialEntry.findFirst.mockResolvedValue({ id: "cred-1" });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    const byName = new Map(result.freshness.map((f) => [f.source, f]));
    expect(byName.get("git-worktree")?.state).toBe("stale");
    expect(byName.get("git-worktree")?.message).toMatch(/Last successful sync \d+ min ago/);
    expect(result.anySnapshotSourceDegraded).toBe(true);
  });

  it("not-configured: no GitHub credential row → github-pr state is not-configured, message points to Contributor MCP card", async () => {
    db.contributorInventorySyncRun.findFirst.mockResolvedValue(
      syncRunRow({
        syncRunId: "run-a",
        completedAt: RECENT,
        snapshots: [
          { payload: { path: "/x", branch: null, headSha: null, isRegistered: true } },
        ],
      }),
    );
    db.credentialEntry.findFirst.mockResolvedValue(null);

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    const github = result.freshness.find((f) => f.source === "github-pr");
    expect(github?.state).toBe("not-configured");
    expect(github?.message).toContain("Contributor MCP");
    expect(github?.count).toBe(0);
  });

  it("error: ContributorInventorySyncRun read throws → state error for that source, other sources unaffected", async () => {
    db.contributorInventorySyncRun.findFirst.mockImplementation(async ({ where }) => {
      const source = (where.perSourceResult.path as string[])[0];
      if (source === "git-worktree") {
        throw new Error("snapshot read failed");
      }
      return null;
    });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    const byName = new Map(result.freshness.map((f) => [f.source, f]));
    expect(byName.get("git-worktree")?.state).toBe("error");
    expect(byName.get("git-worktree")?.message).toContain("snapshot read failed");
    expect(byName.get("git-branch")?.state).toBe("warming-up");
  });

  it("live Prisma sources are always state ok when their reads succeed", async () => {
    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    const liveSources = result.freshness.filter((f) =>
      ["work-capsule", "runtime-target", "runtime-verification", "nonprod-lease"].includes(
        f.source,
      ),
    );
    expect(liveSources.every((f) => f.state === "ok")).toBe(true);
  });

  it("live Prisma source error: workCapsule read throws → state error for work-capsule only", async () => {
    db.workroom.findMany.mockRejectedValueOnce(new Error("db offline"));

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
    });

    const wc = result.freshness.find((f) => f.source === "work-capsule");
    expect(wc?.state).toBe("error");
    expect(wc?.message).toBe("db offline");
  });

  it("custom staleHeartbeatThresholdMs overrides the default 20-minute threshold", async () => {
    db.contributorInventorySyncRun.findFirst.mockResolvedValue(
      syncRunRow({
        syncRunId: "run-x",
        completedAt: new Date(NOW.getTime() - 60_000), // 1 min ago
        snapshots: [
          { payload: { path: "/x", branch: null, headSha: null, isRegistered: true } },
        ],
      }),
    );
    db.credentialEntry.findFirst.mockResolvedValue({ id: "cred" });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      now: NOW,
      staleHeartbeatThresholdMs: 30_000, // 30s — 1-min-old data is stale by this rule
    });

    const worktree = result.freshness.find((f) => f.source === "git-worktree");
    expect(worktree?.state).toBe("stale");
  });
});
