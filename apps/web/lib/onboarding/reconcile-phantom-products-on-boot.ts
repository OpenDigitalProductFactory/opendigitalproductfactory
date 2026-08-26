import { prisma, reconcilePromotedProducts } from "@dpf/db";

/**
 * Upgrade reconciler for phantom / infrastructure products (BI-B19C41B8).
 *
 * A /24 discovery sweep enumerated every address and promoted a
 * "LAN Host 192.168.0.N" DigitalProduct per IP — including addresses that never
 * answered (no MAC) and the platform's own Docker bridge hosts. Hundreds of
 * phantom "products" then buried the real estate and fed coworkers false counts.
 * reconcilePromotedProducts now demotes both platform-internal infra AND
 * unevidenced phantoms; this runs it on boot so an install that already
 * accumulated the phantoms self-heals on upgrade with no operator action.
 *
 * Idempotent and cheap once clean (demotes only products whose every linked
 * entity is infra/phantom; real evidenced devices are kept). Non-fatal.
 */
export async function reconcilePhantomProductsOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<{ demoted: number; kept: number; errors: number } | null> {
  try {
    const summary = await reconcilePromotedProducts(prisma as never);
    if (summary.demoted > 0 || summary.errors > 0) {
      logger.log(
        `[phantom-product-reconcile] demoted ${summary.demoted} infrastructure/phantom product(s), ` +
          `kept ${summary.detachedEntities} inventory row(s), ${summary.errors} error(s)`,
      );
    }
    return { demoted: summary.demoted, kept: summary.kept, errors: summary.errors };
  } catch (error) {
    logger.error("[phantom-product-reconcile] failed (non-fatal)", error);
    return null;
  }
}
