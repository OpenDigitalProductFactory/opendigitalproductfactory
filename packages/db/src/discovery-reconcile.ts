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

import {
  isNonProductEntityType,
  classifyEstateProvenance,
  hasObservationEvidence,
  type EstateProvenance,
} from "./discovery-promotion-policy";
import { INVENTORY_ENTITY_CANONICAL_WHERE } from "./inventory-entity-lifecycle";

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
      inventoryEntities: Array<{
        id: string;
        entityType: string;
        name?: string | null;
        properties?: unknown;
        catalogIdentityId?: string | null;
      }>;
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
 * Decide whether a product is PLATFORM-INTERNAL infrastructure that was wrongly
 * promoted (and should be demoted). Pure — exported for unit testing.
 *
 * A product is demoted only when every linked entity is BOTH an infra entityType
 * AND platform-internal provenance (the platform's own Docker/local runtime).
 * Real-estate devices (a camera/NVR/gateway on the operator's LAN) are kept —
 * they are legitimate Foundational Digital Products even though their entityType
 * is host/network.
 */
export function isInfrastructureProduct(
  linkedEntities: ReadonlyArray<{
    entityType: string;
    provenance: EstateProvenance;
    discoveredVia?: string | null;
    hasResolvedIdentity?: boolean;
  }>,
): boolean {
  return (
    linkedEntities.length > 0 &&
    linkedEntities.every(
      (e) =>
        isNonProductEntityType(e.entityType) &&
        (e.provenance === "platform_internal" ||
          (/^arp(?:_scan|_table)?$/i.test(e.discoveredVia ?? "") && !e.hasResolvedIdentity)),
    )
  );
}

/**
 * Decide whether a promoted product should be demoted — infrastructure OR a
 * phantom. Consolidates the two keep-signals (BI-B19C41B8): a non-product host/
 * network entity is KEPT when it has observation evidence (answered ARP / vendor
 * / hostname / trustworthy source) OR a resolved catalog identity (it was
 * positively identified). It is demoted only when platform-internal, or a bare
 * enumerated /24 address that never answered AND was never identified — a
 * subnet-scan phantom, not a device. A real evidenced/identified LAN device is
 * kept.
 */
export function shouldDemotePromotedProduct(
  linkedEntities: ReadonlyArray<{
    entityType: string;
    provenance: EstateProvenance;
    hasEvidence: boolean;
    hasResolvedIdentity?: boolean;
  }>,
): boolean {
  return (
    linkedEntities.length > 0 &&
    linkedEntities.every(
      (e) =>
        isNonProductEntityType(e.entityType) &&
        (e.provenance === "platform_internal" || (!e.hasEvidence && !e.hasResolvedIdentity)),
    )
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
    where: {
      inventoryEntities: { some: INVENTORY_ENTITY_CANONICAL_WHERE },
    },
    select: {
      id: true,
      productId: true,
      name: true,
      inventoryEntities: {
        where: INVENTORY_ENTITY_CANONICAL_WHERE,
        select: {
          id: true,
          entityType: true,
          name: true,
          properties: true,
          catalogIdentityId: true,
        },
      },
    },
  });

  for (const product of products) {
    const linked = product.inventoryEntities.map((e) => {
      const props = (e.properties ?? {}) as Record<string, unknown>;
      return {
        entityType: e.entityType,
        discoveredVia: typeof props.discoveredVia === "string" ? props.discoveredVia : null,
        hasResolvedIdentity: Boolean(e.catalogIdentityId),
        provenance: classifyEstateProvenance({
          discoveredVia: typeof props.discoveredVia === "string" ? props.discoveredVia : null,
          addressHint:
            (typeof props.address === "string" && props.address) ||
            (typeof props.ip === "string" && props.ip) ||
            e.name ||
            null,
        }),
        hasEvidence: hasObservationEvidence({ properties: e.properties }),
      };
    });
    if (!shouldDemotePromotedProduct(linked)) {
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
