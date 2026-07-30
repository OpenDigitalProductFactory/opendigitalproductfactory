export const SELF_UPGRADE_PURPOSE_STATES = [
  "update-available",
  "queued-or-running",
  "current",
  "failed-recoverable",
  "blocked",
] as const;

export type SelfUpgradePurposeState =
  (typeof SELF_UPGRADE_PURPOSE_STATES)[number];

const PURPOSE_SIGNALS: Record<
  SelfUpgradePurposeState,
  { completion: string; correction: string }
> = {
  "update-available": {
    completion: "upgrade-queue-acknowledgement",
    correction: "upgrade-request-error",
  },
  "queued-or-running": {
    completion: "upgrade-progress-visible",
    correction: "stalled-run-recovery",
  },
  current: {
    completion: "current-version-visible",
    correction: "status-refresh",
  },
  "failed-recoverable": {
    completion: "recovery-controls-reachable",
    correction: "failure-reason-visible",
  },
  blocked: {
    completion: "blocker-route-reachable",
    correction: "blocker-reason-visible",
  },
};

export type SelfUpgradePurposeStatus = {
  statusAvailable?: boolean;
  enabled: boolean;
  isFresh: boolean;
  targetSha: string | null;
  latestRun: { status: string } | null;
  quiescence?: { blockers?: readonly unknown[] } | null;
  jobEngine?: { healthy: boolean } | null;
  windowSource?: string | null;
};

const IN_FLIGHT = new Set(["queued", "pending", "running", "completing"]);

export function resolveSelfUpgradePurposeSignals(
  state: SelfUpgradePurposeState,
): { completion: string; correction: string } {
  return PURPOSE_SIGNALS[state];
}

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
  if (status.statusAvailable === false) return "blocked";
  if (status.isFresh || !status.targetSha) return "current";
  if (
    !status.enabled ||
    status.jobEngine?.healthy === false ||
    status.windowSource === "needs-timezone"
  ) {
    return "blocked";
  }
  return "update-available";
}

export function resolveSelfUpgradePurposeBlocker(
  status: SelfUpgradePurposeStatus,
): string | null {
  if (status.statusAvailable === false) {
    return "Update status is temporarily unavailable.";
  }
  if (!status.enabled) return "Automatic platform updates are disabled.";
  if (status.jobEngine?.healthy === false) {
    return "The update worker is unavailable.";
  }
  if (status.windowSource === "needs-timezone") {
    return "Operating timezone is required before updates can be scheduled safely.";
  }
  return null;
}

export function resolveSelfUpgradePurposeRecovery(
  status: SelfUpgradePurposeStatus,
): { href: string; label: string } {
  if (status.statusAvailable === false) {
    return {
      href: "/ops/self-upgrade",
      label: "Retry status check",
    };
  }
  if (status.windowSource === "needs-timezone") {
    return {
      href: "/storefront/settings/operations",
      label: "Set operating timezone",
    };
  }
  if (status.jobEngine?.healthy === false && status.statusAvailable !== false) {
    return { href: "/ops/health", label: "Open platform health" };
  }
  if (!status.enabled) {
    return {
      href: "/docs/operations/self-upgrade#enable-self-upgrade",
      label: "How to enable self-upgrade",
    };
  }
  return {
    href: "/docs/operations/self-upgrade",
    label: "Open recovery guidance",
  };
}
