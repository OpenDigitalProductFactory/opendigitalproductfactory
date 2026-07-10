/**
 * Pure stall-detection decision logic (BI-4ab6be39 slice C2).
 *
 * Given one candidate TaskRun row, the resolved threshold, and the current
 * time, decide whether it has stalled and why. No side effects — kept pure so
 * tests don't need a DB.
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §5.7, §5.8.
 */
import { isStale } from "@/lib/shared/staleness";
import type { ResolvedThreshold } from "./threshold-lookup";

export interface WatchdogCandidate {
  taskRunId: string;
  buildId: string | null;
  phase: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date | null;
  /**
   * TaskRun.source. Distinguishes the real build-execution run (source="build")
   * from ancillary runs that also carry a buildId — notably the "proactive"
   * deliberation runs (design/plan review) that leak in the `working` state
   * after the review completes. Only a stalled source="build" run may surface a
   * build-phase FAILURE; a stalled deliberation run must not fail the build it
   * happens to be tagged with. See taskrun-watchdog.ts stallSurface gate.
   */
  source: string | null;
}

/**
 * Whether a stalled candidate may surface a build-phase FAILURE (a failed
 * checkpoint on the FeatureBuild). True ONLY for the real build-execution
 * TaskRun (source="build") of a build currently in the "build" phase.
 *
 * A leaked deliberation run (source="proactive", "Deliberation: review") carries
 * the same buildId but is NOT the build's execution — failing the build on its
 * stall marks a HEALTHY build failed after codegen but before commit, which is
 * what stranded builds with correct-but-uncommitted code (the empty-diff
 * symptom). The stalled run is still marked stalled + audited by the caller;
 * this guard only decides whether it corrupts the build's exec state.
 */
export function shouldSurfaceBuildFailure(
  candidate: Pick<WatchdogCandidate, "buildId" | "phase" | "source">,
  hasBuildRow: boolean,
): boolean {
  return (
    Boolean(candidate.buildId) &&
    hasBuildRow &&
    candidate.phase === "build" &&
    candidate.source === "build"
  );
}

export type StallReason =
  | "heartbeat_timeout"
  | "total_timeout"
  | "never_started"
  // Cascade reasons — emitted by recovery actions in slice F2 / §6.5,
  // not by the watchdog itself.
  | "parent_stalled"
  | "parent_abandoned";

export interface StallDecision {
  candidate: WatchdogCandidate;
  threshold: ResolvedThreshold;
  reason: StallReason;
}

/**
 * total_timeout wins over heartbeat_timeout / never_started if both would
 * trip — wall-clock cap is the "alive but livelocked" catchall and is the
 * stronger signal when present.
 */
export function decideStall(
  candidate: WatchdogCandidate,
  threshold: ResolvedThreshold,
  now: Date,
): StallDecision | null {
  if (isStale(now, candidate.startedAt, threshold.totalPhaseTimeoutSeconds * 1000)) {
    return { candidate, threshold, reason: "total_timeout" };
  }
  if (candidate.lastHeartbeatAt === null) {
    if (isStale(now, candidate.startedAt, threshold.heartbeatTimeoutSeconds * 1000)) {
      return { candidate, threshold, reason: "never_started" };
    }
    return null;
  }
  if (isStale(now, candidate.lastHeartbeatAt, threshold.heartbeatTimeoutSeconds * 1000)) {
    return { candidate, threshold, reason: "heartbeat_timeout" };
  }
  return null;
}
