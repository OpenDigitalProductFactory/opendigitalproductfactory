import { describe, expect, it, vi } from "vitest";

import { loadCapsuleLivenessInventory } from "./liveness-inventory";

describe("loadCapsuleLivenessInventory", () => {
  it("keeps stored, live, reapable, and history counts distinct", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const base = {
      title: "Room", source: "external-adoption", executorKind: "codex-desktop",
      decisionScope: null, portfolioRole: null, servedPersona: null, activityKind: null,
      outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [], headBranch: "feat/x",
      worktreePath: "D:/x", pullRequestUrl: null, pullRequestNumber: null, lastSyncedAt: null,
      updatedAt: now, featureBuildId: null,
    };
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([
        { ...base, capsuleId: "WC-LIVE", status: "working", leaseExpiresAt: new Date("2026-08-24T19:00:00.000Z") },
        { ...base, capsuleId: "WC-EXPIRED", status: "working", leaseExpiresAt: new Date("2026-08-22T17:00:00.000Z") }, // ~2 days ago — past the 24h resume grace
        { ...base, capsuleId: "WC-DONE", status: "complete", leaseExpiresAt: null },
      ]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.livenessSummary).toEqual({
      scanned: 3,
      live: 1,
      history: 2,
      reapable: 1,
      byLiveness: { live: 1, "lease-expired": 1, terminal: 1 },
      heavyLane: { executing: 0, nextReady: 0, dormant: 0 },
      progressSlo: { oldestWaitMs: null, maxNoTransitionMs: null },
    });
  });

  it("projects exact durable waits into liveness, lane state, and progress SLOs", async () => {
    const now = new Date("2026-08-24T18:00:00.000Z");
    const db = {
      workroom: { findMany: vi.fn().mockResolvedValue([{
        capsuleId: "WC-WAIT", title: "Waiting", status: "working", source: "external-adoption",
        executorKind: "codex-desktop", decisionScope: null, portfolioRole: null, servedPersona: null,
        activityKind: null, outcomeAnchor: {}, servesPortfolioRoles: [], dependsOnPortfolioRoles: [],
        headBranch: "fix/wait", worktreePath: "D:/wait", pullRequestUrl: null, pullRequestNumber: null,
        leaseExpiresAt: new Date("2026-08-24T17:00:00.000Z"), lastSyncedAt: null,
        updatedAt: new Date("2026-08-24T16:00:00.000Z"), featureBuildId: null,
      }]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
      nonProductionEnvironmentLease: { findMany: vi.fn().mockResolvedValue([
        { leaseId: "NPEL-A", environmentKey: "local-integration-ci", status: "queued", worktreePath: "D:/wait", branchName: "fix/wait", queuedAt: new Date("2026-08-24T17:00:00.000Z"), admittedAt: null, heartbeatAt: null, updatedAt: new Date("2026-08-24T17:00:00.000Z") },
        { leaseId: "NPEL-B", environmentKey: "local-integration-ci", status: "queued", worktreePath: "D:/other", branchName: "fix/other", queuedAt: new Date("2026-08-24T17:30:00.000Z"), admittedAt: null, heartbeatAt: null, updatedAt: new Date("2026-08-24T17:30:00.000Z") },
      ]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.capsulesAll[0]).toMatchObject({ liveness: "durable-wait", isLive: true, isReapable: false });
    expect(result.livenessSummary.heavyLane).toEqual({ executing: 0, nextReady: 1, dormant: 1 });
    expect(result.livenessSummary.progressSlo).toEqual({ oldestWaitMs: 3_600_000, maxNoTransitionMs: 3_600_000 });
  });
});
