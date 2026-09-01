import { describe, expect, it, vi } from "vitest";

import {
  BacklogItemAlreadyClaimedError,
  assertBacklogWorkroomClaimAvailable,
  loadBacklogWorkroomOwnership,
  lockBacklogItemForClaim,
} from "./backlog-workroom-ownership";

const now = new Date("2026-08-31T18:00:00.000Z");

function room(overrides: Record<string, unknown> = {}) {
  return {
    capsuleId: "WC-LIVE",
    title: "Live work",
    status: "working",
    source: "external-adoption",
    backlogItemId: "BI-ONE",
    repositoryFullName: "org/repo",
    executorKind: "codex-desktop",
    executorRef: "session-one",
    leaseHolderPrincipalId: "PRN-ONE",
    headBranch: "fix/one",
    worktreePath: "/worktrees/one",
    pullRequestUrl: null,
    pullRequestNumber: null,
    leaseExpiresAt: new Date("2026-08-31T19:00:00.000Z"),
    lastSyncedAt: null,
    updatedAt: now,
    featureBuildId: null,
    ...overrides,
  };
}

const liveSummary = {
  capsuleId: "WC-LIVE", repositoryFullName: "org/repo", headBranch: "fix/one",
  worktreePath: "/worktrees/one", executorKind: "codex-desktop", executorRef: "session-one",
  leaseHolderPrincipalId: "PRN-ONE", leaseExpiresAt: "2026-08-31T19:00:00.000Z",
  liveness: "live", isLive: true, livenessReason: "Lease valid.", trueLivenessAt: now.toISOString(),
};

describe("backlog Workroom ownership", () => {
  it("uses canonical liveness and retains dead rooms as history", async () => {
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([
        room(),
        room({ capsuleId: "WC-DEAD", headBranch: "fix/dead", leaseExpiresAt: new Date("2026-08-31T17:00:00.000Z") }),
      ]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const ownership = await loadBacklogWorkroomOwnership(db, "BI-ONE", now);

    expect(db.workroom.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { backlogItemId: { in: ["BI-ONE"] }, archivedAt: null },
    }));
    expect(ownership.workrooms).toHaveLength(2);
    expect(ownership.liveWorkrooms.map((entry) => entry.capsuleId)).toEqual(["WC-LIVE"]);
    expect(ownership.workrooms[1]).toMatchObject({ capsuleId: "WC-DEAD", isLive: false, liveness: "lease-expired" });
  });

  it("refuses a different live Workroom before adoption", () => {
    const live = [liveSummary];

    expect(() => assertBacklogWorkroomClaimAvailable({
      backlogItemId: "BI-ONE",
      liveWorkrooms: live,
      repositoryFullName: "org/repo",
      headBranch: "fix/two",
      force: false,
      overrideReason: null,
    })).toThrow(BacklogItemAlreadyClaimedError);
  });

  it("allows exact Workroom idempotency and reasoned override only", () => {
    const live = [liveSummary];

    expect(assertBacklogWorkroomClaimAvailable({
      backlogItemId: "BI-ONE", liveWorkrooms: live, repositoryFullName: "org/repo",
      headBranch: "fix/one", force: false, overrideReason: null,
    })).toEqual({ overrideConflicts: [] });
    expect(() => assertBacklogWorkroomClaimAvailable({
      backlogItemId: "BI-ONE", liveWorkrooms: live, repositoryFullName: "org/repo",
      headBranch: "fix/two", force: true, overrideReason: null,
    })).toThrow(/overrideReason/);
    expect(assertBacklogWorkroomClaimAvailable({
      backlogItemId: "BI-ONE", liveWorkrooms: live, repositoryFullName: "org/repo",
      headBranch: "fix/two", force: true, overrideReason: "Split independent acceptance lanes.",
    })).toEqual({ overrideConflicts: live });
  });

  it("locks the canonical BacklogItem row before ownership evaluation", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: "row-bi-one" }]);

    await lockBacklogItemForClaim({ $queryRaw: queryRaw }, "row-bi-one");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]?.[0].join(" ")).toContain('FROM "BacklogItem"');
    expect(queryRaw.mock.calls[0]?.[0].join(" ")).toContain("FOR UPDATE");
    expect(queryRaw.mock.calls[0]?.[1]).toBe("row-bi-one");
  });
});
