import type {
  SelfUpgradePurposeState,
  SelfUpgradePurposeStatus,
} from "@/lib/self-upgrade/purpose-scenario";

const ACTIVE_RUN_STATUSES = new Set([
  "queued",
  "pending",
  "running",
  "completing",
]);

/**
 * Independent Purpose oracle for Self-Upgrade.
 *
 * This adapter deliberately does not call the page classifier. It reads the
 * canonical status shape through a separate mapping so a page-classification
 * defect can disagree with the oracle and become observable.
 */
export function resolveSelfUpgradePurposeOracle(
  status: SelfUpgradePurposeStatus,
): SelfUpgradePurposeState {
  const latestRunStatus = status.latestRun?.status ?? null;
  if (latestRunStatus && ACTIVE_RUN_STATUSES.has(latestRunStatus)) {
    return "queued-or-running";
  }
  if (latestRunStatus === "failed") return "failed-recoverable";
  if (status.statusAvailable === false) return "blocked";
  if (status.isFresh || status.targetSha === null) return "current";
  if (
    status.enabled === false ||
    status.jobEngine?.healthy === false ||
    status.windowSource === "needs-timezone"
  ) {
    return "blocked";
  }
  return "update-available";
}
