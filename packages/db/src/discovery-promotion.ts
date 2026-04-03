// discovery-promotion.ts
// Auto-promotes high-confidence InventoryEntity records to DigitalProduct records.
// Called after each discovery sweep's persistence pass.

export const AUTO_PROMOTE_THRESHOLD = 0.90;

export const PROMOTABLE_TYPES = [
  "host",
  "runtime",
  "container",
  "database",
  "monitoring_service",
  "ai_service",
  "application",
];

export type PromotionSummary = {
  promoted: number;
  skipped: number;
  errors: number;
};

export function generateProductId(entityType: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return entityType === "host" ? `host-${slug}` : `infra-${slug}`;
}

type PromotionDb = {
  inventoryEntity: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<{
      id: string;
      entityKey: string;
      entityType: string;
      name: string;
      attributionConfidence: number | null;
      taxonomyNodeId: string | null;
      digitalProductId: string | null;
      properties: unknown;
    }>>;
    update(args: { where: { id: string }; data: { digitalProductId: string } }): Promise<unknown>;
  };
  taxonomyNode: {
    findUnique(args: { where: { id: string }; select: { id: true; nodeId: true } }): Promise<{ id: string; nodeId: string } | null>;
  };
  portfolio: {
    findUnique(args: { where: { slug: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  digitalProduct: {
    findUnique(args: { where: { productId: string }; select: { id: true } }): Promise<{ id: string } | null>;
    upsert(args: {
      where: { productId: string };
      update: Record<string, unknown>;
      create: Record<string, unknown>;
      select: { id: true; productId: true };
    }): Promise<{ id: string; productId: string }>;
  };
};

export async function promoteInventoryEntities(db: PromotionDb): Promise<PromotionSummary> {
  const summary: PromotionSummary = { promoted: 0, skipped: 0, errors: 0 };

  const entities = await db.inventoryEntity.findMany({
    where: {
      attributionStatus: "attributed",
      attributionConfidence: { gte: AUTO_PROMOTE_THRESHOLD },
      digitalProductId: null,
      taxonomyNodeId: { not: null },
      entityType: { in: PROMOTABLE_TYPES },
    },
    select: {
      id: true,
      entityKey: true,
      entityType: true,
      name: true,
      attributionConfidence: true,
      taxonomyNodeId: true,
      digitalProductId: true,
      properties: true,
    },
  });

  for (const entity of entities) {
    try {
      // Skip if already linked (double-check since query should filter)
      if (entity.digitalProductId) {
        summary.skipped++;
        continue;
      }

      // Skip if no taxonomy placement
      if (!entity.taxonomyNodeId) {
        summary.skipped++;
        continue;
      }

      // Resolve taxonomy node to get nodeId path
      const taxonomyNode = await db.taxonomyNode.findUnique({
        where: { id: entity.taxonomyNodeId },
        select: { id: true, nodeId: true },
      });
      if (!taxonomyNode) {
        summary.skipped++;
        continue;
      }

      // Resolve portfolio from taxonomy root segment
      const rootSlug = taxonomyNode.nodeId.split("/")[0];
      const portfolio = rootSlug
        ? await db.portfolio.findUnique({ where: { slug: rootSlug }, select: { id: true } })
        : null;
      if (!portfolio) {
        // No portfolio found — can't promote, send to exception queue
        summary.skipped++;
        continue;
      }

      const productId = generateProductId(entity.entityType, entity.name);

      // Upsert the DigitalProduct (update if exists, create if not)
      const product = await db.digitalProduct.upsert({
        where: { productId },
        update: {
          name: entity.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          taxonomyNodeId: taxonomyNode.id,
          portfolioId: portfolio.id,
        },
        create: {
          productId,
          name: entity.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          taxonomyNodeId: taxonomyNode.id,
          portfolioId: portfolio.id,
        },
        select: { id: true, productId: true },
      });

      // Link entity back to the product
      await db.inventoryEntity.update({
        where: { id: entity.id },
        data: { digitalProductId: product.id },
      });

      summary.promoted++;
      console.log(`[discovery-promotion] Promoted ${entity.name} -> ${product.productId}`);
    } catch (err) {
      summary.errors++;
      console.error(`[discovery-promotion] Failed to promote ${entity.entityKey}:`, err);
    }
  }

  return summary;
}
