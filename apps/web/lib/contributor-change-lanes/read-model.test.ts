import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadContributorChangeLaneReadModel,
  type LaneReadModelInventoryRunners,
} from "./read-model";

const NOW = new Date("2026-05-26T22:00:00.000Z");
const FRESH = new Date("2026-05-26T21:58:00.000Z");

function makeDb() {
  return {
    workCapsule: { findMany: vi.fn() },
    runtimeTarget: { findMany: vi.fn() },
    runtimeVerification: { findMany: vi.fn() },
    nonProductionEnvironmentLease: { findMany: vi.fn() },
  };
}

type DbHarness = ReturnType<typeof makeDb>;

function dbAsAny(db: DbHarness): any {
  return db;
}

function makeRunners(overrides: Partial<LaneReadModelInventoryRunners> = {}): LaneReadModelInventoryRunners {
  return {
    runGitWorktreeList: async () => "",
    runGitForEachRef: async () => "",
    runGhPrList: async () => "[]",
    listFilesystemWorktreePaths: async () => [],
    ...overrides,
  };
}

describe("loadContributorChangeLaneReadModel", () => {
  let db: DbHarness;

  beforeEach(() => {
    db = makeDb();
    db.workCapsule.findMany.mockResolvedValue([]);
    db.runtimeTarget.findMany.mockResolvedValue([]);
    db.runtimeVerification.findMany.mockResolvedValue([]);
    db.nonProductionEnvironmentLease.findMany.mockResolvedValue([]);
  });

  it("returns lanes and a freshness row per source on the happy path", async () => {
    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners: makeRunners(),
      now: NOW,
    });

    expect(result.lanes).toEqual([]);
    const sources = result.freshness.map((f) => f.source).sort();
    expect(sources).toEqual([
      "git-branch",
      "git-worktree",
      "github-pr",
      "nonprod-lease",
      "runtime-target",
      "runtime-verification",
      "work-capsule",
    ]);
    expect(result.freshness.every((f) => f.ok)).toBe(true);
  });

  it("joins a Prisma WorkCapsule + RuntimeTarget into one lane row", async () => {
    db.workCapsule.findMany.mockResolvedValueOnce([
      {
        capsuleId: "WC-INT-1",
        title: "Integration",
        status: "working",
        executorKind: "claude-desktop",
        executorRef: "session-a",
        headBranch: "feat/x",
        headSha: "abc123",
        worktreePath: "D:/DPF/.claude/worktrees/x",
        pullRequestUrl: "https://example.com/pr/1",
        backlogItemId: "BI-INT",
        featureBuildId: null,
        leaseHolderPrincipalId: "p-1",
        leaseExpiresAt: new Date(NOW.getTime() + 60_000),
        updatedAt: FRESH,
        objective: "Make X work",
      },
    ]);
    db.runtimeTarget.findMany.mockResolvedValueOnce([
      {
        targetId: "RT-INT-1",
        kind: "dev-portal",
        status: "running",
        hostUrl: "http://localhost:3001",
        serviceVersion: "abc123",
        workCapsuleId: "WC-INT-1",
        featureBuildId: null,
        acceptanceRoleOverride: null,
        lastHeartbeatAt: FRESH,
        expiresAt: null,
        metadata: { servedCommitSha: "abc123", branchName: "feat/x" },
      },
    ]);
    db.runtimeVerification.findMany.mockResolvedValueOnce([
      {
        verificationId: "RV-1",
        runtimeTargetId: "RT-INT-1",
        workCapsuleId: "WC-INT-1",
        kind: "ux",
        status: "passed",
        completedAt: FRESH,
        result: { summary: "OK" },
      },
    ]);

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners: makeRunners(),
      now: NOW,
    });

    expect(result.lanes).toHaveLength(1);
    const lane = result.lanes[0]!;
    expect(lane.runtimeTargetId).toBe("RT-INT-1");
    expect(lane.workCapsuleId).toBe("WC-INT-1");
    expect(lane.branch).toBe("feat/x");
    expect(lane.servedCommitSha).toBe("abc123");
    expect(lane.commitSha).toBe("abc123");
    expect(lane.latestVerification.status).toBe("passed");
    expect(lane.status).toBe("ready-for-review");
  });

  it("records a freshness error and continues when work-capsule Prisma read throws", async () => {
    db.workCapsule.findMany.mockRejectedValueOnce(new Error("db offline"));

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners: makeRunners(),
      now: NOW,
    });

    const wcFreshness = result.freshness.find((f) => f.source === "work-capsule");
    expect(wcFreshness).toBeDefined();
    expect(wcFreshness!.ok).toBe(false);
    expect(wcFreshness!.error).toBe("db offline");
    expect(result.lanes).toEqual([]);
  });

  it("records a freshness error when the gh runner throws but still returns other sources", async () => {
    const runners = makeRunners({
      runGhPrList: async () => {
        throw new Error("gh not installed");
      },
    });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners,
      now: NOW,
    });

    const prFreshness = result.freshness.find((f) => f.source === "github-pr");
    expect(prFreshness).toBeDefined();
    expect(prFreshness!.ok).toBe(false);
    expect(prFreshness!.error).toBe("gh not installed");
    const otherSources = result.freshness.filter((f) => f.source !== "github-pr");
    expect(otherSources.every((f) => f.ok)).toBe(true);
  });

  it("flags a runner as missing when no runner function is configured", async () => {
    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners: {},
      now: NOW,
    });
    const sources = result.freshness.filter((f) => !f.ok).map((f) => f.source).sort();
    expect(sources).toEqual(["git-branch", "git-worktree", "github-pr"]);
    expect(
      result.freshness
        .filter((f) => !f.ok)
        .every((f) => f.error === "no runner configured"),
    ).toBe(true);
  });

  it("merges filesystem-only worktree paths into the inventory", async () => {
    const runners = makeRunners({
      runGitWorktreeList: async () => "worktree D:/DPF\nHEAD abc\nbranch refs/heads/main\n",
      listFilesystemWorktreePaths: async () => ["D:/DPF/.claude/worktrees/orphan-fs"],
    });

    const result = await loadContributorChangeLaneReadModel({
      db: dbAsAny(db),
      runners,
      now: NOW,
    });

    const orphanRows = result.lanes.filter((l) => l.source === "worktree");
    expect(orphanRows).toHaveLength(1);
    expect(orphanRows[0]!.worktreePath).toBe("D:/DPF/.claude/worktrees/orphan-fs");
    expect(orphanRows[0]!.blockers[0]).toMatch(/Filesystem-only/);
  });
});
