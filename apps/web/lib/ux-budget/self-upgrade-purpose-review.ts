import type { LatestRun } from "@/lib/self-upgrade/run-types";
import {
  SELF_UPGRADE_PURPOSE_STATES,
  type SelfUpgradePurposeState,
  type SelfUpgradePurposeStatus,
} from "@/lib/self-upgrade/purpose-scenario";

export { SELF_UPGRADE_PURPOSE_STATES };
export type SelfUpgradePurposeReviewState = SelfUpgradePurposeState;

export type SelfUpgradePurposeReviewStatus = SelfUpgradePurposeStatus & {
  statusAvailable: boolean;
  deployedSha: string;
  nextWindowStart: string | null;
  blackoutUntil: string | null;
  blackoutName: string | null;
  platformVersion: { version: string; gitSha: string };
  latestRun: LatestRun | null;
};

function fixtureRun(status: string): LatestRun {
  return {
    runId: `SUR-PURPOSE-${status.toUpperCase()}`,
    status,
    trigger: "purpose-review",
    currentSha: "abc1234",
    targetSha: "def5678",
    deployedSha: status === "failed" ? "abc1234" : "def5678",
    reason: status === "failed" ? "The candidate did not pass health checks." : null,
    startedAt: "2026-07-30T05:00:00.000Z",
    completedAt: status === "failed" ? "2026-07-30T05:04:00.000Z" : null,
    completionEvidence: null,
    failureLog:
      status === "failed"
        ? "[build-failure-class] health-check-failed\nThe candidate did not pass health checks."
        : null,
    createdAt: "2026-07-30T05:00:00.000Z",
  };
}

export function isSelfUpgradePurposeReviewState(
  value: string,
): value is SelfUpgradePurposeReviewState {
  return SELF_UPGRADE_PURPOSE_STATES.some((state) => state === value);
}

export function isSelfUpgradePurposeReviewEnabled(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.DPF_PURPOSE_REVIEW_FIXTURES === "1";
}

export function buildSelfUpgradePurposeReviewStatus(
  state: SelfUpgradePurposeReviewState,
): SelfUpgradePurposeReviewStatus {
  const base: SelfUpgradePurposeReviewStatus = {
    statusAvailable: true,
    enabled: true,
    isFresh: false,
    targetSha: "def5678",
    deployedSha: "abc1234",
    nextWindowStart: "2026-07-31T07:00:00.000Z",
    blackoutUntil: null,
    blackoutName: null,
    platformVersion: { version: "vabc1234", gitSha: "abc1234" },
    latestRun: null,
    jobEngine: { healthy: true },
    windowSource: "operating-hours",
    quiescence: { blockers: [] },
  };

  if (state === "queued-or-running") {
    return { ...base, latestRun: fixtureRun("running") };
  }
  if (state === "current") {
    return {
      ...base,
      isFresh: true,
      targetSha: "abc1234",
      deployedSha: "abc1234",
    };
  }
  if (state === "failed-recoverable") {
    return { ...base, latestRun: fixtureRun("failed") };
  }
  if (state === "blocked") {
    return { ...base, enabled: false };
  }
  return base;
}
