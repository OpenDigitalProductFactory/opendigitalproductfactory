import { describe, expect, it, vi } from "vitest";
import {
  isInfrastructureProduct,
  reconcilePromotedProducts,
} from "./discovery-reconcile";

describe("isInfrastructureProduct", () => {
  it("is true when every linked entity is an infra type", () => {
    expect(isInfrastructureProduct(["host"])).toBe(true);
    expect(isInfrastructureProduct(["network_interface", "subnet"])).toBe(true);
    expect(isInfrastructureProduct(["gateway", "host", "docker_host"])).toBe(true);
  });

  it("is false when any linked entity is product-shaped", () => {
    expect(isInfrastructureProduct(["host", "database"])).toBe(false);
    expect(isInfrastructureProduct(["service"])).toBe(false);
    expect(isInfrastructureProduct(["application"])).toBe(false);
  });

  it("is false when there are no linked entities (seed/registered product)", () => {
    expect(isInfrastructureProduct([])).toBe(false);
  });
});

function makeDb(products: Array<{
  id: string;
  productId: string;
  name: string;
  inventoryEntities: Array<{ id: string; entityType: string }>;
}>) {
  return {
    digitalProduct: {
      findMany: vi.fn().mockResolvedValue(products),
      delete: vi.fn().mockResolvedValue({}),
    },
    inventoryEntity: {
      updateMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { digitalProductId: string } }) => {
          const p = products.find((x) => x.id === where.digitalProductId);
          return Promise.resolve({ count: p ? p.inventoryEntities.length : 0 });
        }),
    },
  };
}

describe("reconcilePromotedProducts", () => {
  it("demotes infra products, detaches their inventory, and keeps real products", async () => {
    const db = makeDb([
      { id: "p_host", productId: "host-lan-host-172-18-0-1", name: "LAN Host 172.18.0.1", inventoryEntities: [{ id: "e1", entityType: "host" }] },
      { id: "p_nic", productId: "infra-eth0-172-18-0-11", name: "eth0 (172.18.0.11)", inventoryEntities: [{ id: "e2", entityType: "network_interface" }] },
      { id: "p_db", productId: "infra-postgres-core", name: "PostgreSQL Database", inventoryEntities: [{ id: "e3", entityType: "database" }] },
    ]);

    const summary = await reconcilePromotedProducts(db as never);

    expect(summary.demoted).toBe(2);
    expect(summary.detachedEntities).toBe(2);
    expect(summary.kept).toBe(1);
    expect(summary.errors).toBe(0);

    // The two infra products were deleted; the database product was not.
    expect(db.digitalProduct.delete).toHaveBeenCalledTimes(2);
    const deletedIds = db.digitalProduct.delete.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(deletedIds).toContain("p_host");
    expect(deletedIds).toContain("p_nic");
    expect(deletedIds).not.toContain("p_db");

    // Inventory was detached before delete (preserved as infra inventory).
    expect(db.inventoryEntity.updateMany).toHaveBeenCalledWith({
      where: { digitalProductId: "p_host" },
      data: { digitalProductId: null },
    });
  });

  it("is idempotent — a clean estate demotes nothing", async () => {
    const db = makeDb([
      { id: "p_db", productId: "infra-postgres-core", name: "PostgreSQL Database", inventoryEntities: [{ id: "e3", entityType: "database" }] },
    ]);
    const summary = await reconcilePromotedProducts(db as never);
    expect(summary.demoted).toBe(0);
    expect(summary.kept).toBe(1);
    expect(db.digitalProduct.delete).not.toHaveBeenCalled();
  });

  it("counts a failed demotion as an error without throwing", async () => {
    const db = makeDb([
      { id: "p_host", productId: "host-x", name: "LAN Host", inventoryEntities: [{ id: "e1", entityType: "host" }] },
    ]);
    db.digitalProduct.delete.mockRejectedValueOnce(new Error("FK constraint"));

    const summary = await reconcilePromotedProducts(db as never);
    expect(summary.errors).toBe(1);
    expect(summary.demoted).toBe(0);
  });
});
