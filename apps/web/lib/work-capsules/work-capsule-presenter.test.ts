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
      portfolioRoleLabel: "Products & Services Sold",
      servedPersona: "customer",
      activityKind: "delivery",
      activityKindLabel: "Delivery",
      outcomeAnchorLabel: "Onboard Contoso",
      servesPortfolioRoleLabels: ["Products & Services Sold", "Manufacture & Deliver"],
      dependsOnPortfolioRoleLabels: ["Foundational"],
    });
  });
});
