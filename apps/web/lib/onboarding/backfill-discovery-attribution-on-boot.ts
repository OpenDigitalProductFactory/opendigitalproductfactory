import { backfillDiscoveryAttribution, type AttributionBackfillReport } from "@dpf/db";

/**
 * Upgrade reconciler for discovery attribution (BI-BAF38ED3).
 *
 * Installs that discovered their estate before the fingerprint layer was wired
 * into every ingestion path carry InventoryEntity rows the coarse `host ->
 * /servers` heuristic mis-binned, with no resolved identity. Fixing the wiring
 * only helps the next sweep; this pass re-runs the fingerprint layer over the
 * rows already persisted so the estate self-heals on upgrade with no operator
 * action.
 *
 * Idempotent and cheap once healed: `backfillDiscoveryAttribution` writes only
 * rows whose attribution actually changes, so a healthy install pays one scan
 * and no writes. Non-fatal — a discovery-attribution problem must never block
 * portal boot.
 */
export async function backfillDiscoveryAttributionOnBoot(
  logger: Pick<Console, "log" | "warn" | "error"> = console,
): Promise<AttributionBackfillReport | null> {
  try {
    const report = await backfillDiscoveryAttribution();

    if (report.noInputs) {
      logger.warn(
        "[discovery-attribution-backfill] skipped: no active fingerprint rules / taxonomy loaded — nothing to heal",
      );
      return report;
    }

    // Stay quiet on a healthy install; only speak when something was healed.
    if (report.fingerprinted > 0 || report.demotedToReview > 0) {
      logger.log(
        `[discovery-attribution-backfill] done: ${report.fingerprinted} re-identified, ` +
          `${report.demotedToReview} demoted to review (of ${report.scanned} scanned)`,
      );
    }
    return report;
  } catch (error) {
    logger.error(
      "[discovery-attribution-backfill] failed (non-fatal)",
      error,
    );
    return null;
  }
}
