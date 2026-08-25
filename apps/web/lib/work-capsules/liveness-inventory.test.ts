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
        { ...base, capsuleId: "WC-EXPIRED", status: "working", leaseExpiresAt: new Date("2026-08-24T17:00:00.000Z") },
        { ...base, capsuleId: "WC-DONE", status: "complete", leaseExpiresAt: null },
      ]) },
      featureBuild: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await loadCapsuleLivenessInventory(db, { where: {}, take: 100 }, now);

    expect(result.livenessSummary).toEqual({
      scanned: 3,
      live: 1,
      history: 2,
      reapable: 1,
      byLiveness: { live: 1, "lease-expired": 1, terminal: 1 },
    });
  });
});
