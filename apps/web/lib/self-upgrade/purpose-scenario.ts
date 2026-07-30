export const SELF_UPGRADE_PURPOSE_STATES = [
  "update-available",
  "queued-or-running",
  "current",
  "failed-recoverable",
  "blocked",
] as const;

export type SelfUpgradePurposeState =
  (typeof SELF_UPGRADE_PURPOSE_STATES)[number];

export type SelfUpgradePurposeStatus = {
  enabled: boolean;
  isFresh: boolean;
  targetSha: string | null;
  latestRun: { status: string } | null;
  quiescence?: { blockers?: readonly unknown[] } | null;
  jobEngine?: { healthy: boolean } | null;
  windowSource?: string | null;
};

const IN_FLIGHT = new Set(["queued", "pending", "running", "completing"]);

/**
 * Route-owned state oracle for Purpose evaluation.
 *
 * The page and the independent evaluator adapter consume this pure projection of
 * getSelfUpgradeStatus(). Rendered DOM markers never decide their own state.
 */
export function resolveSelfUpgradePurposeScenario(
  status: SelfUpgradePurposeStatus,
): SelfUpgradePurposeState {
  const runStatus = status.latestRun?.status ?? null;
  if (runStatus && IN_FLIGHT.has(runStatus)) return "queued-or-running";
  if (runStatus === "failed") return "failed-recoverable";
  if (
    !status.enabled ||
    status.jobEngine?.healthy === false ||
    status.windowSource === "needs-timezone"
  ) {
    return "blocked";
  }
  if (status.isFresh || !status.targetSha) return "current";
  return "update-available";
}

export function resolveSelfUpgradePurposeBlocker(
  status: SelfUpgradePurposeStatus,
): string | null {
  if (!status.enabled) return "Automatic platform updates are disabled.";
  if (status.jobEngine?.healthy === false) {
    return "The update worker is unavailable.";
  }
  if (status.windowSource === "needs-timezone") {
    return "Operating timezone is required before updates can be scheduled safely.";
  }
  return null;
}
