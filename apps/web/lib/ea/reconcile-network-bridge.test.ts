import { describe, expect, it, vi } from "vitest";
import { reconcileNetworkTopology } from "./reconcile-network-bridge";

// BI-6C41A9DC: the network bridge must project only the platform's own estate into the
// org-internal architecture graph; customer-scoped discovery (MSP/reseller customer
// devices) must not leak in. These tests assert the source-level scope filter, using the
// same seeder-skips-on-absent-notation pattern as reconcile-routes.test.ts so the full
// thread runs without a real DB.

describe("reconcileNetworkTopology — scope boundary (BI-6C41A9DC)", () => {
  it("queries only org-internal EdgeNode / InventoryEntity / InventoryRelationship rows", async () => {
    const edgeFindMany = vi.fn().mockResolvedValue([
      { nodeId: "node-1", platform: "linux", installMode: "standalone", version: "1.0.0", status: "online", trustState: "trusted", lastSeenAt: null },
    ]);
    const entityFindMany = vi.fn().mockResolvedValue([
      { id: "e1", entityKey: "switch-1", entityType: "network-device", name: "Internal switch", technicalClass: null, manufacturer: null, productModel: null, status: "active" },
    ]);
    const relFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      edgeNode: { findMany: edgeFindMany },
      inventoryEntity: { findMany: entityFindMany },
      inventoryRelationship: { findMany: relFindMany },
      // Notation absent → applySysmlModel skips, but the read path (incl. the scoped
      // queries) has already run, which is what we assert below.
      eaNotation: { findUnique: vi.fn().mockResolvedValue(null) },
    };

    const r = await reconcileNetworkTopology({ db: db as never });

    expect(edgeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerAccountId: null } }));
    expect(entityFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: "organization:internal" } }));
    expect(relFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scopeKey: "organization:internal" } }));
    // The seeder was reached (proves the filtered rows threaded model → seeder end-to-end).
    expect(db.eaNotation.findUnique).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("skipped");
  });

  it("skips cleanly when there are no org-internal rows — without touching the relationship query or the seeder", async () => {
    const db = {
      edgeNode: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryEntity: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryRelationship: { findMany: vi.fn() },
      eaNotation: { findUnique: vi.fn() },
    };

    const r = await reconcileNetworkTopology({ db: db as never });

    expect(r.status).toBe("skipped");
    expect(db.inventoryRelationship.findMany).not.toHaveBeenCalled(); // gated on entityRows.length
    expect(db.eaNotation.findUnique).not.toHaveBeenCalled(); // seeder not reached
  });
});
