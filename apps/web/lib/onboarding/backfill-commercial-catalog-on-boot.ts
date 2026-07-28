import { prisma } from "@dpf/db";

import { seedMarketOffer } from "./seed-market-offer";

export type CommercialCatalogBackfillResult = {
  storefrontsPresent: number;
  storefrontsReconciled: number;
  linked: number;
  unresolved: number;
  failed: number;
};

/**
 * Expand-release reconciler for storefront projections that predate the
 * canonical business catalog. Healthy installs pay one count query per
 * storefront; only active unlinked rows invoke the existing setup authority.
 */
export async function backfillCommercialCatalogOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<CommercialCatalogBackfillResult | null> {
  try {
    const storefronts = await prisma.storefrontConfig.findMany({
      select: {
        id: true,
        organizationId: true,
        _count: {
          select: {
            items: {
              where: {
                isActive: true,
                catalogItemId: null,
              },
            },
          },
        },
      },
    });
    const result: CommercialCatalogBackfillResult = {
      storefrontsPresent: 0,
      storefrontsReconciled: 0,
      linked: 0,
      unresolved: 0,
      failed: 0,
    };

    for (const storefront of storefronts) {
      if (storefront._count.items === 0) {
        result.storefrontsPresent++;
        continue;
      }

      try {
        const reconciled = await seedMarketOffer({
          organizationId: storefront.organizationId,
        });
        result.storefrontsReconciled++;
        result.linked += reconciled.linkedCatalogItemCount;
        result.unresolved += reconciled.unresolvedCatalogItemCount;

        if (reconciled.unresolvedCatalogItemCount > 0) {
          logger.warn(
            `[commercial-catalog-backfill] storefront ${storefront.id}: ${reconciled.unresolvedCatalogItemCount} unresolved active item(s); no relationship was inferred without product-line evidence`,
          );
        }
      } catch (error) {
        result.failed++;
        logger.warn(
          `[commercial-catalog-backfill] storefront ${storefront.id}: reconciliation failed (non-fatal)`,
          error,
        );
      }
    }

    if (
      result.storefrontsReconciled > 0 ||
      result.unresolved > 0 ||
      result.failed > 0
    ) {
      logger.log(
        `[commercial-catalog-backfill] done: ${result.linked} linked, ${result.unresolved} unresolved, ${result.failed} failed`,
      );
    }
    return result;
  } catch (error) {
    logger.error(
      "[commercial-catalog-backfill] failed before storefront reconciliation (non-fatal)",
      error,
    );
    return null;
  }
}
