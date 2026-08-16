// apps/web/lib/build/unified-wip-query.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  loadActiveUnifiedWip,
  poolPressure,
  TERMINAL_CAPSULE_STATUSES,
  type UnifiedWipDb,
} from "./unified-wip-query";
import { decideUnifiedWip, BUILD_WIP_CAP } from "./wip-cap";

type CapsuleRow = {
  executorKind: string | null;
  worktreePath: string | null;
  headBranch: string | null;
};
type LeaseRow = { worktreePath: string | null; branchName: string | null };

function makeDb(opts: {
  activeBsBuilds: number;
  capsules?: CapsuleRow[];
  activeLeases?: LeaseRow[];
}): { db: UnifiedWipDb; featureBuildCount: ReturnType<typeof vi.fn>; capsuleFindMany: ReturnType<typeof vi.fn> } {
  const featureBuildCount = vi.fn().mockResolvedValue(opts.activeBsBuilds);
  const capsuleFindMany = vi.fn().mockResolvedValue(opts.capsules ?? []);
  const leaseFindMany = vi.fn().mockResolvedValue(opts.activeLeases ?? []);
  const db: UnifiedWipDb = {
    featureBuild: { count: featureBuildCount },
    workroom: { findMany: capsuleFindMany },
    nonProductionEnvironmentLease: { findMany: leaseFindMany },
  };
  return { db, featureBuildCount, capsuleFindMany };
}

describe("loadActiveUnifiedWip (BI-937128F6)", () => {
  it("sources bs-sandbox pressure from the authoritative active FeatureBuild count", async () => {
    const { db, featureBuildCount } = makeDb({ activeBsBuilds: 2 });
    const summary = await loadActiveUnifiedWip(db);

    expect(summary.bsSandboxContending).toBe(2);
    expect(poolPressure(summary, "bs-sandbox")).toBe(2);
    // Excludes terminal builds + abandoned + child (epic) builds, exactly like
    // the legacy BS-only gate did.
    expect(featureBuildCount).toHaveBeenCalledWith({
      where: { phase: { notIn: ["complete", "failed"] }, abandonedAt: null, parentEpicId: null },
    });
  });

  it("does NOT count build-studio capsules toward bs-sandbox (excluded in the capsule query)", async () => {
    const { db, capsuleFindMany } = makeDb({ activeBsBuilds: 1 });
    await loadActiveUnifiedWip(db);
    const where = (capsuleFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.executorKind).toEqual({ not: "build-studio" });
    expect(where.status).toEqual({ notIn: [...TERMINAL_CAPSULE_STATUSES] });
    expect(where.archivedAt).toBeNull();
  });

  it("counts active capsules from every other surface into the unified total", async () => {
    const { db } = makeDb({
      activeBsBuilds: 1,
      capsules: [
        { executorKind: "claude-desktop", worktreePath: "/w/a", headBranch: "feat/a" },
        { executorKind: "codex-desktop", worktreePath: "/w/b", headBranch: "feat/b" },
        { executorKind: "grok-desktop", worktreePath: null, headBranch: null },
      ],
    });
    const summary = await loadActiveUnifiedWip(db);

    expect(summary.total).toBe(4); // 1 BS build + 3 external capsules
    expect(summary.perSurface).toEqual({
      "build-studio": 1,
      "claude-desktop": 1,
      "codex-desktop": 1,
      "grok-desktop": 1,
    });
  });

  it("classifies an external capsule as shared-lease when it matches an active :3001 lease (by worktree)", async () => {
    const { db } = makeDb({
      activeBsBuilds: 0,
      capsules: [
        { executorKind: "codex-desktop", worktreePath: "/w/leased", headBranch: "feat/leased" },
        { executorKind: "claude-desktop", worktreePath: "/w/free", headBranch: "feat/free" },
      ],
      activeLeases: [{ worktreePath: "/w/leased", branchName: null }],
    });
    const summary = await loadActiveUnifiedWip(db);

    expect(summary.sharedLeaseContending).toBe(1);
    expect(summary.hostWorktreeOnly).toBe(1);
    expect(poolPressure(summary, "shared-lease")).toBe(1);
    expect(poolPressure(summary, "host-worktree")).toBe(1);
  });

  it("matches an active lease by branch name too", async () => {
    const { db } = makeDb({
      activeBsBuilds: 0,
      capsules: [{ executorKind: "grok-desktop", worktreePath: "/w/x", headBranch: "feat/runtime" }],
      activeLeases: [{ worktreePath: null, branchName: "feat/runtime" }],
    });
    const summary = await loadActiveUnifiedWip(db);
    expect(summary.sharedLeaseContending).toBe(1);
  });

  it("only reads active, unexpired leases", async () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const { db } = makeDb({ activeBsBuilds: 0 });
    const leaseFindMany = db.nonProductionEnvironmentLease.findMany as ReturnType<typeof vi.fn>;
    await loadActiveUnifiedWip(db, now);
    expect(leaseFindMany).toHaveBeenCalledWith({
      where: { status: "active", expiresAt: { gt: now } },
      select: { worktreePath: true, branchName: true },
    });
  });

  it("defaults a null executorKind capsule to dpf-native (host-worktree)", async () => {
    const { db } = makeDb({
      activeBsBuilds: 0,
      capsules: [{ executorKind: null, worktreePath: "/w/n", headBranch: "feat/n" }],
    });
    const summary = await loadActiveUnifiedWip(db);
    expect(summary.perSurface).toEqual({ "dpf-native": 1 });
    expect(summary.hostWorktreeOnly).toBe(1);
  });
});

describe("unified WIP gate end-to-end (BI-937128F6 regression pin)", () => {
  it("blocks a new BS build once 3 builds are active — the exact pre-refactor behavior", async () => {
    const { db } = makeDb({
      activeBsBuilds: 3,
      // A pile of active external capsules MUST NOT affect the bs-sandbox gate:
      // they contend on other pools.
      capsules: [
        { executorKind: "claude-desktop", worktreePath: "/w/a", headBranch: "a" },
        { executorKind: "codex-desktop", worktreePath: "/w/b", headBranch: "b" },
      ],
    });
    const summary = await loadActiveUnifiedWip(db);
    const decision = decideUnifiedWip("bs-sandbox", poolPressure(summary, "bs-sandbox"));

    expect(decision.pressure).toBe(3);
    expect(decision.capacity).toBe(BUILD_WIP_CAP);
    expect(decision.admitted).toBe(false);
  });

  it("admits a new BS build at 2 active builds even with many external capsules in flight", async () => {
    const { db } = makeDb({
      activeBsBuilds: 2,
      capsules: Array.from({ length: 10 }, (_, i) => ({
        executorKind: "claude-desktop",
        worktreePath: `/w/${i}`,
        headBranch: `feat/${i}`,
      })),
    });
    const summary = await loadActiveUnifiedWip(db);
    const decision = decideUnifiedWip("bs-sandbox", poolPressure(summary, "bs-sandbox"));

    expect(decision.pressure).toBe(2);
    expect(decision.admitted).toBe(true);
  });
});
