import { describe, expect, it } from "vitest";

import { presentCapsuleRow } from "./work-capsule-presenter";

describe("presentCapsuleRow", () => {
  it("marks expired leases", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-1",
      title: "Adopt work",
      status: "working",
      source: "external-adoption",
      executorKind: "codex-desktop",
      headBranch: "feat/adopt",
      worktreePath: "D:/DPF-adopt",
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-05-14T00:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:00:00.000Z"),
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("lease-expired");
  });

  it("marks stale scanner cache when the lease is still active", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-2",
      title: "Scanner lag",
      status: "ready",
      source: "manual",
      executorKind: null,
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T02:00:00.000Z"),
      lastSyncedAt: new Date("2026-05-14T00:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:00:00.000Z"),
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("stale-cache");
    expect(row.executorKind).toBe("unassigned");
    expect(row.branch).toBe("no branch");
  });

  it("marks a working capsule that has not advanced as stalled, not ok", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-STALL",
      title: "Add timestamps",
      status: "working",
      source: "manual",
      executorKind: "build-studio",
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T05:00:00.000Z"), // lease still valid
      lastSyncedAt: new Date("2026-05-14T01:00:00.000Z"), // freshly synced (not stale-cache)
      updatedAt: new Date("2026-05-14T00:30:00.000Z"), // no progress for 30 min
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("stalled");
  });

  it("keeps a freshly-advanced working capsule healthy", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-OK",
      title: "Add timestamps",
      status: "working",
      source: "manual",
      executorKind: "build-studio",
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T05:00:00.000Z"),
      lastSyncedAt: new Date("2026-05-14T01:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:58:00.000Z"), // advanced 2 min ago
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("ok");
  });

  it("does not flag a non-working capsule as stalled", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-READY",
      title: "Queued work",
      status: "ready",
      source: "manual",
      executorKind: null,
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T05:00:00.000Z"),
      lastSyncedAt: new Date("2026-05-14T01:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:00:00.000Z"), // old, but not "working"
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("ok");
  });

  it("presents readable scope labels for Work Control", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-SCOPE",
      title: "Customer onboarding",
      status: "working",
      source: "manual",
      executorKind: "codex-desktop",
      decisionScope: "wwwd",
      portfolioRole: "productsAndServicesSold",
      servedPersona: "customer",
      activityKind: "delivery",
      outcomeAnchor: { kind: "work-case", id: "CASE-123", label: "Onboard Contoso" },
      servesPortfolioRoles: ["productsAndServicesSold", "manufactureAndDeliver"],
      dependsOnPortfolioRoles: ["foundational"],
      headBranch: "feat/customer-onboarding",
      worktreePath: "D:/DPF-customer-onboarding",
      pullRequestUrl: null,
      leaseExpiresAt: null,
      lastSyncedAt: null,
      updatedAt: new Date("2026-05-14T00:00:00.000Z"),
    });

    expect(row.scope).toEqual({
      decisionScope: "wwwd",
      decisionScopeLabel: "WWWD",
      portfolioRole: "productsAndServicesSold",
      portfolioRoleLabel: "Goods and Services for Sale",
      servedPersona: "customer",
      activityKind: "delivery",
      activityKindLabel: "Delivery",
      outcomeAnchorLabel: "Onboard Contoso",
      servesPortfolioRoleLabels: ["Goods and Services for Sale", "Manufacture & Deliver"],
      dependsOnPortfolioRoleLabels: ["Foundational"],
    });
  });
});
