// discovery-reconcile.ts
// Reconciles ALREADY-promoted DigitalProducts against the current promotion
// policy and demotes the ones that should never have been products.
//
// Why this exists: before the structural entityType gate
// (discovery-promotion-policy.ts), an auto-promotion taxonomy node (e.g.
// "foundational/compute/servers", "foundational/network_management/
// network_connectivity") promoted every discovered host / NIC / subnet /
// gateway into the product portfolio. The gate stops NEW pollution; this
// routine cleans the EXISTING rows so the portfolio reflects the real estate.
//
// Demotion is idempotent and conservative: a product is demoted ONLY when it
// has at least one linked InventoryEntity AND every linked entity is a
// non-product (infrastructure / transport / runtime-instance) type. The
// entities themselves are preserved — they are real discovered infrastructure;
// they simply stop being mislabeled as products (their digitalProductId is
// nulled, so they remain attributed to their taxonomy node as inventory).

import { isNonProductEntityType } from "./discovery-promotion-policy";

export type ReconcileSummary = {
  /** DigitalProducts removed because they were infrastructure, not products. */
  demoted: number;
  /** InventoryEntity rows detached (digitalProductId nulled) and kept as inventory. */
  detachedEntities: number;
  /** Products inspected but left in place (genuinely product-shaped). */
  kept: number;
  /** Demotions that failed (e.g. blocking FK) — left in place, logged. */
  errors: number;
};

type ReconcileDb = {
  digitalProduct: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{
      id: string;
      productId: string;
      name: string;
      inventoryEntities: Array<{ id: string; entityType: string }>;
    }>>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  inventoryEntity: {
    updateMany(args: {
      where: { digitalProductId: string };
      data: { digitalProductId: null };
    }): Promise<{ count: number }>;
  };
};

/**
 * Decide whether a product is infrastructure that was wrongly promoted.
 * Pure — exported for unit testing.
 */
export function isInfrastructureProduct(
  linkedEntityTypes: readonly string[],
): boolean {
  return (
    linkedEntityTypes.length > 0 &&
    linkedEntityTypes.every((t) => isNonProductEntityType(t))
  );
}

export async function reconcilePromotedProducts(
  db: ReconcileDb,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    demoted: 0,
    detachedEntities: 0,
    kept: 0,
    errors: 0,
  };

  // Only products that carry discovered inventory can be discovery-promoted
  // infrastructure. Seed/registered products with no linked entities are
  // never touched.
  const products = await db.digitalProduct.findMany({
    where: { inventoryEntities: { some: {} } },
    select: {
      id: true,
      productId: true,
      name: true,
      inventoryEntities: { select: { id: true, entityType: true } },
    },
  });

  for (const product of products) {
    const types = product.inventoryEntities.map((e) => e.entityType);
    if (!isInfrastructureProduct(types)) {
      summary.kept++;
      continue;
    }

    try {
      const detached = await db.inventoryEntity.updateMany({
        where: { digitalProductId: product.id },
        data: { digitalProductId: null },
      });
      summary.detachedEntities += detached.count;
      await db.digitalProduct.delete({ where: { id: product.id } });
      summary.demoted++;
      console.log(
        `[discovery-reconcile] Demoted infrastructure product ${product.productId} (${product.name}); kept ${detached.count} inventory rows`,
      );
    } catch (err) {
      summary.errors++;
      console.error(
        `[discovery-reconcile] Failed to demote ${product.productId}:`,
        err,
      );
    }
  }

  return summary;
}
