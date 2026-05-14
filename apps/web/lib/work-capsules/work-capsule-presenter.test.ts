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
});
