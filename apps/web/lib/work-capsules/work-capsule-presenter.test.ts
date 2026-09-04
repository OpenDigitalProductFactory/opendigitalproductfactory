import { describe, expect, it } from "vitest";

import { presentCapsuleRow } from "./work-capsule-presenter";

describe("presentCapsuleRow", () => {
  it("marks expired leases (past the resume grace)", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-1",
      title: "Adopt work",
      status: "working",
      source: "external-adoption",
      executorKind: "codex-desktop",
      headBranch: "feat/adopt",
      worktreePath: "D:/DPF-adopt",
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-12T00:00:00.000Z"), // ~49h before now — past 24h grace
      lastSyncedAt: new Date("2026-05-12T00:00:00.000Z"),
      updatedAt: new Date("2026-05-12T00:00:00.000Z"),
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("lease-expired");
  });

  it("marks a RECENTLY expired lease as paused, not lease-expired (token-limited session may resume)", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-PAUSE",
      title: "Paused session",
      status: "working",
      source: "external-adoption",
      executorKind: "grok-cli",
      headBranch: "feat/paused",
      worktreePath: "D:/DPF-paused",
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T00:00:00.000Z"), // 1h before now — inside grace
      lastSyncedAt: new Date("2026-05-14T00:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:00:00.000Z"),
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("paused");
    expect(row.isLive).toBe(true);
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

  it("WS9: a null-lease capsule idle past the floor reads stalled, not ok", () => {
    // The frozen-14:00 Build Studio shape: no lease, no sync, no build signal,
    // updatedAt stuck at birth. Liveness must come from that idle age, not the
    // presence of a recent updatedAt.
    const row = presentCapsuleRow({
      capsuleId: "WC-STALL",
      title: "Frozen build-studio capsule",
      status: "working",
      source: "build-studio",
      executorKind: "build-studio",
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: null,
      lastSyncedAt: null,
      updatedAt: new Date("2026-05-12T14:00:00.000Z"), // born two days ago at 14:00
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("stalled");
    expect(row.isLive).toBe(false);
    expect(row.liveness).toBe("idle-stale");
  });

  it("WS9: a valid lease reads live even when updatedAt is old (updatedAt is not liveness)", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-LIVE-LEASE",
      title: "Actively leased work",
      status: "working",
      source: "external-adoption",
      executorKind: "codex-desktop",
      headBranch: "feat/x",
      worktreePath: "D:/DPF-x",
      pullRequestUrl: null,
      leaseExpiresAt: new Date("2026-05-14T05:00:00.000Z"), // lease still valid
      lastSyncedAt: new Date("2026-05-14T01:00:00.000Z"),
      updatedAt: new Date("2026-05-14T00:30:00.000Z"), // old — must NOT flag stalled
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("ok");
    expect(row.isLive).toBe(true);
    expect(row.liveness).toBe("live");
  });

  it("WS9: a capsule whose linked build is abandoned reads abandoned-build, not working-healthy", () => {
    const row = presentCapsuleRow({
      capsuleId: "WC-ZOMBIE",
      title: "Build died, capsule stuck working",
      status: "working",
      source: "build-studio",
      executorKind: "build-studio",
      headBranch: null,
      worktreePath: null,
      pullRequestUrl: null,
      leaseExpiresAt: null,
      lastSyncedAt: null,
      updatedAt: new Date("2026-05-14T00:50:00.000Z"), // recently born — updatedAt looks fresh
      featureBuild: { phase: "abandoned", lastActivityAt: new Date("2026-05-13T09:00:00.000Z") },
    }, new Date("2026-05-14T01:00:00.000Z"));

    expect(row.health).toBe("abandoned-build");
    expect(row.isLive).toBe(false);
    expect(row.liveness).toBe("build-terminal");
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
