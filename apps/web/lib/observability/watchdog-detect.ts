/**
 * Pure stall-detection decision logic (BI-4ab6be39 slice C2).
 *
 * Given one candidate TaskRun row, the resolved threshold, and the current
 * time, decide whether it has stalled and why. No side effects — kept pure so
 * tests don't need a DB.
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §5.7, §5.8.
 */
import type { ResolvedThreshold } from "./threshold-lookup";

export interface WatchdogCandidate {
  taskRunId: string;
  buildId: string | null;
  phase: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date | null;
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
  const ageMs = now.getTime() - candidate.startedAt.getTime();
  if (ageMs > threshold.totalPhaseTimeoutSeconds * 1000) {
    return { candidate, threshold, reason: "total_timeout" };
  }
  if (candidate.lastHeartbeatAt === null) {
    if (ageMs > threshold.heartbeatTimeoutSeconds * 1000) {
      return { candidate, threshold, reason: "never_started" };
    }
    return null;
  }
  const silenceMs = now.getTime() - candidate.lastHeartbeatAt.getTime();
  if (silenceMs > threshold.heartbeatTimeoutSeconds * 1000) {
    return { candidate, threshold, reason: "heartbeat_timeout" };
  }
  return null;
}
