/**
 * BI-DB87D925 — server half of service-reconcile-outcome.ts: read promote.sh's
 * outcome file from the state mount and merge it into the run's evidence.
 *
 * The run is marked succeeded by reconcileSelfUpgradeRunsOnBoot when the new
 * portal boots, before the promoter reaches step 7d, so the outcome can only be
 * picked up afterwards: once a few minutes after boot, then on the same 20-minute
 * cadence as the self-upgrade watchdog. Idempotent and non-fatal.
 */
import { readFile } from "node:fs/promises";
import { attachServiceReconcileOutcome, SERVICE_RECONCILE_OUTCOME_PATH } from "./service-reconcile-outcome";
import { findSucceededRunForPromotedSha, recordServiceReconcileOutcome } from "./run-store";

const FIRST_ATTACH_DELAY_MS = 5 * 60 * 1000;
const ATTACH_INTERVAL_MS = 20 * 60 * 1000;

export async function attachServiceReconcileOutcomeToRun(
  logger: Pick<Console, "log" | "error"> = console,
): Promise<void> {
  try {
    const attached = await attachServiceReconcileOutcome({
      readOutcome: () => readFile(SERVICE_RECONCILE_OUTCOME_PATH, "utf8").catch(() => null),
      findRun: findSucceededRunForPromotedSha,
      record: recordServiceReconcileOutcome,
    });
    if (attached) {
      logger.log(`[self-upgrade-reconcile] ${attached.runId} service-reconcile outcome: ${attached.outcome}`);
    }
  } catch (err) {
    logger.error("[self-upgrade-reconcile] service-reconcile outcome attach failed (non-fatal):", err);
  }
}

/** Called once from instrumentation at boot. */
export function scheduleServiceReconcileAttach(): void {
  setTimeout(() => void attachServiceReconcileOutcomeToRun(), FIRST_ATTACH_DELAY_MS);
  setInterval(() => void attachServiceReconcileOutcomeToRun(), ATTACH_INTERVAL_MS);
}
