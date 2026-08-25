import { describe, expect, it, vi } from "vitest";
import { renewNonprodEnvironmentLease } from "./environment-lease";

const NOW = new Date("2026-07-28T21:00:00.000Z");

function renewalDb() {
  const findUnique = vi.fn().mockResolvedValue({
    status: "active",
    ownerSessionId: "session-1",
    expiresAt: new Date(NOW.getTime() + 60_000),
    environmentKey: "local-integration-ci",
    slotKey: "slot-1",
    slotManifestVersion: 1,
    phase: "admitted-unbound",
  });
  return {
    findUnique,
    db: { nonProductionEnvironmentLease: { findUnique, update: vi.fn() } },
  };
}

describe("nonproduction lease slot-binding liveness", () => {
  it("rejects an unbound or mismatched slot-aware renewal", async () => {
    const { db, findUnique } = renewalDb();
    const renew = (slotBinding?: {
      manifestVersion: 1;
      slotKey: "slot-0" | "slot-1";
      url: string;
      ports: number[];
      cleanupCommand: string;
    }) => renewNonprodEnvironmentLease({
      db: db as never,
      leaseId: "NPEL-1",
      ownerSessionId: "session-1",
      slotBinding,
      now: NOW,
    });

    await expect(renew()).rejects.toThrow("nonprod_slot_binding_required");
    await expect(renew({
      manifestVersion: 1,
      slotKey: "slot-0",
      url: "http://localhost:3010",
      ports: [3010, 15432],
      cleanupCommand: "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-0",
    })).rejects.toThrow("nonprod_slot_binding_mismatch");
    await expect(renew({
      manifestVersion: 1,
      slotKey: "slot-1",
      url: "http://localhost:3010",
      ports: [3010, 15432],
      cleanupCommand: "node scripts/local-ci-slot-cleanup.mjs --slot-key slot-1",
    })).rejects.toThrow("nonprod_slot_resource_binding_mismatch");
    expect(findUnique).toHaveBeenCalledTimes(3);
    expect(db.nonProductionEnvironmentLease.update).not.toHaveBeenCalled();
  });
});
