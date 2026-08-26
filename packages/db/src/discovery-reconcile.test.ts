import { describe, expect, it, vi } from "vitest";
import {
  isInfrastructureProduct,
  reconcilePromotedProducts,
} from "./discovery-reconcile";

const INT = "platform_internal" as const;
const REAL = "real_estate" as const;

describe("isInfrastructureProduct", () => {
  it("is true when every linked entity is platform-internal infra", () => {
    expect(isInfrastructureProduct([{ entityType: "host", provenance: INT }])).toBe(true);
    expect(isInfrastructureProduct([{ entityType: "network_interface", provenance: INT }, { entityType: "subnet", provenance: INT }])).toBe(true);
  });

  it("is false when any linked entity is product-shaped", () => {
    expect(isInfrastructureProduct([{ entityType: "host", provenance: INT }, { entityType: "database", provenance: INT }])).toBe(false);
    expect(isInfrastructureProduct([{ entityType: "service", provenance: INT }])).toBe(false);
  });

  it("is FALSE when an infra entity is real-estate provenance (a real device is kept)", () => {
    // A camera/NVR/gateway on the operator's LAN is a Foundational Digital
    // Product even though its entityType is host/network — never demoted.
    expect(isInfrastructureProduct([{ entityType: "host", provenance: REAL }])).toBe(false);
    expect(isInfrastructureProduct([{ entityType: "gateway", provenance: REAL }])).toBe(false);
  });

  it("is true for a bare ARP placeholder even when its address is on the real LAN", () => {
    expect(isInfrastructureProduct([{
      entityType: "host",
      provenance: REAL,
      discoveredVia: "arp_scan",
      hasResolvedIdentity: false,
    }])).toBe(true);
    expect(isInfrastructureProduct([{
      entityType: "host",
      provenance: REAL,
      discoveredVia: "arp_scan",
      hasResolvedIdentity: true,
    }])).toBe(false);
  });

  it("is false when there are no linked entities (seed/registered product)", () => {
    expect(isInfrastructureProduct([])).toBe(false);
  });
});

function makeDb(products: Array<{
  id: string;
  productId: string;
  name: string;
  inventoryEntities: Array<{ id: string; entityType: string; name?: string | null; properties?: unknown; catalogIdentityId?: string | null }>;
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

  it("DEMOTES a subnet-scan phantom product (real-estate IP, no observation evidence) — BI-B19C41B8", async () => {
    // A /24 sweep promoted a "LAN Host 192.168.0.N" per IP. These never answered
    // (no MAC), so they are phantoms, not devices — demoted even though the
    // address is on the operator's real LAN. The evidenced NVR beside it is kept.
    const db = makeDb([
      { id: "p_phantom", productId: "host-p", name: "LAN Host 192.168.0.0", inventoryEntities: [{ id: "e1", entityType: "host", name: "LAN Host 192.168.0.0", properties: { discoveredVia: "arp_table", address: "192.168.0.0" } }] },
      { id: "p_nvr", productId: "dev-nvr", name: "Reolink NVR", inventoryEntities: [{ id: "e2", entityType: "host", name: "NVR 192.168.0.42", properties: { discoveredVia: "arp_table", address: "192.168.0.42", mac: "ec:71:db:aa:bb:cc" } }] },
    ]);

    const summary = await reconcilePromotedProducts(db as never);

    expect(summary.demoted).toBe(1);
    expect(summary.kept).toBe(1);
    const deletedIds = db.digitalProduct.delete.mock.calls.map((c) => (c[0] as { where: { id: string } }).where.id);
    expect(deletedIds).toContain("p_phantom");
    expect(deletedIds).not.toContain("p_nvr");
  });

  it("KEEPS a real-estate device product (host-type but UniFi-discovered)", async () => {
    // The 2026-06 estate fix: a Reolink NVR / UniFi gateway is a Foundational
    // Digital Product. Its entityType is host/gateway, but its provenance is
    // real-estate (192.168 / unifi), so reconcile must NOT demote it — while a
    // Docker host on 172.18 IS demoted.
    const db = makeDb([
      { id: "p_real", productId: "dev-nvr", name: "Reolink NVR", inventoryEntities: [{ id: "e1", entityType: "host", name: "NVR 192.168.0.42", properties: { discoveredVia: "unifi_clients_api", address: "192.168.0.42" } }] },
      { id: "p_docker", productId: "host-172", name: "LAN Host 172.18.0.5", inventoryEntities: [{ id: "e2", entityType: "host", name: "LAN Host 172.18.0.5", properties: { discoveredVia: "arp_table", address: "172.18.0.5" } }] },
    ]);

    const summary = await reconcilePromotedProducts(db as never);

    expect(summary.demoted).toBe(1); // only the Docker host
    expect(summary.kept).toBe(1); // the real-estate NVR
    const deletedIds = db.digitalProduct.delete.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id,
    );
    expect(deletedIds).toContain("p_docker");
    expect(deletedIds).not.toContain("p_real");
  });

  it("demotes an existing bare ARP LAN Host product but keeps a fingerprint-resolved one", async () => {
    const db = makeDb([
      { id: "p_phantom", productId: "host-lan-host-192-168-0-42", name: "LAN Host 192.168.0.42", inventoryEntities: [{ id: "e1", entityType: "host", name: "LAN Host 192.168.0.42", properties: { discoveredVia: "arp_scan", address: "192.168.0.42" } }] },
      { id: "p_known", productId: "device-ring", name: "Ring doorbell", inventoryEntities: [{ id: "e2", entityType: "host", name: "Ring doorbell", properties: { discoveredVia: "arp_scan", address: "192.168.0.43" }, catalogIdentityId: "catalog-ring" }] },
    ]);

    const summary = await reconcilePromotedProducts(db as never);

    expect(summary.demoted).toBe(1);
    expect(summary.kept).toBe(1);
    expect(db.digitalProduct.delete).toHaveBeenCalledWith({ where: { id: "p_phantom" } });
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
