import type { BuildPhase } from "@/lib/feature-build-types";
import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import { isTransientInferenceFailure } from "@/lib/build/inference-failure";

export type BuildStudioOwnerState =
  | "working"
  | "waiting-capacity"
  | "waiting-owner"
  | "blocked"
  | "inconclusive"
  | "failed"
  | "complete"
  | "not-started";

/** Compact badge copy kept with the canonical state vocabulary. */
export function ownerStateBadgeLabel(state: BuildStudioOwnerState): string {
  switch (state) {
    case "working": return "Working";
    case "waiting-capacity": return "Capacity wait";
    case "waiting-owner": return "Needs you";
    case "blocked": return "Needs attention";
    case "inconclusive": return "Needs review";
    case "failed": return "Stopped";
    case "complete": return "Complete";
    case "not-started": return "Preparing";
  }
}

/**
 * Reconcile the server-projected capsule/phase status with the live progress
 * read model. This client-safe module is the one seam for Build Studio owner
 * state; it adds no persisted status machine and imports server models as types.
 */
export function reconcileBuildStudioCustomerStatus(args: {
  phase: BuildPhase;
  status: BuildStudioCustomerStatus;
  progress: BuildProgressVisibility | null | undefined;
}): BuildStudioCustomerStatus {
  const { phase, progress } = args;
  const status = {
    ...args.status,
    evidence: ownerSafeStatusEvidence(args.status.evidence),
  };

  // The Workroom projection is the durable authority when it has already
  // reached a terminal state. FeatureBuild.phase and dispatch rows can lag that
  // transition, so stale in-flight evidence must never resurrect stopped work.
  const projectedOwnerState = ownerStateFromStatus(status);
  if (projectedOwnerState === "complete") {
    return {
      ...status,
      ownerState: "complete",
      needsYou: false,
      expectation: status.expectation
        ?? "The result and its evidence will remain here when you return.",
    };
  }
  if (projectedOwnerState === "failed") {
    return {
      ...status,
      ownerState: "failed",
      needsYou: true,
      expectation: status.expectation
        ?? "You can leave this page and return; Build Studio will keep this stopped state recorded.",
    };
  }

  if (phase === "complete") {
    return {
      ...status,
      ownerState: "complete",
      lifecyclePosition: "Done",
      worker: "Finished",
      needsYou: false,
      expectation: "The result and its evidence will remain here when you return.",
    };
  }
  if (phase === "failed" || phase === "abandoned") {
    return {
      ...status,
      ownerState: "failed",
      lifecyclePosition: phase === "failed" ? "The build stopped" : "Work stopped",
      worker: "Build Studio is not working on this change",
      needsYou: true,
    };
  }

  if (!progress) {
    return { ...status, ownerState: projectedOwnerState };
  }

  const failure = progress.inferenceFailure;
  if (failure?.failed) {
    const elapsedLabel = formatElapsedLabel(failure.observedAt, progress.generatedAt, "Waiting");
    if (isTransientInferenceFailure(failure.kind)) {
      return {
        ...status,
        ownerState: "waiting-capacity",
        lifecyclePosition: "Waiting for AI capacity",
        worker: "The AI service is briefly unavailable",
        evidence: "Build Studio did not receive a usable response after its automatic retries.",
        nextAction: "Retry when convenient. Build Studio will show any new result here.",
        owner: "owner",
        needsYou: true,
        ...(elapsedLabel ? { elapsedLabel } : {}),
        expectation: "Brief interruptions are retried automatically before this status appears. You can leave this page and return.",
      };
    }
    if (failure.kind === "config") {
      return {
        ...status,
        ownerState: "blocked",
        lifecyclePosition: "AI setup needs attention",
        worker: "Build Studio cannot reach an eligible AI service",
        evidence: "No configured AI service can handle this request.",
        nextAction: "Ask a platform administrator to check AI provider setup, then retry.",
        owner: "platform administrator",
        needsYou: true,
        ...(elapsedLabel ? { elapsedLabel } : {}),
      };
    }
    return {
      ...status,
      ownerState: "inconclusive",
      lifecyclePosition: "No usable AI response",
      worker: "Build Studio could not confirm a result",
      evidence: "The AI service returned no usable response.",
      nextAction: "Retry the AI call. If it happens again, review the technical details.",
      owner: "owner",
      needsYou: true,
      ...(elapsedLabel ? { elapsedLabel } : {}),
    };
  }

  if (isWaitingForOwner(status)) {
    return { ...status, ownerState: "waiting-owner" };
  }

  const inFlight = latestInflightDispatch(progress);
  if (inFlight) {
    const elapsedLabel = formatElapsedLabel(inFlight.startedAt, progress.generatedAt, "Working");
    return {
      ...status,
      ownerState: "working",
      lifecyclePosition: workingStageLabel(phase),
      worker: "Build Studio is working on this change",
      evidence: "A build step is running and no owner decision is needed.",
      nextAction: "No action needed unless Build Studio asks for a decision.",
      owner: "Build Studio",
      needsYou: false,
      ...(elapsedLabel ? { elapsedLabel } : {}),
      expectation: "Long steps can take several minutes. You can leave this page and return; the latest result will appear here.",
    };
  }

  if (
    (phase === "build" || phase === "review")
    && progress.tasks.totalTasks === 0
    && progress.dispatchHistory.length === 0
  ) {
    return {
      ...status,
      ownerState: "not-started",
      lifecyclePosition: phase === "build" ? "Preparing the build" : "Preparing the checks",
      worker: phase === "build" ? "No implementation task has started" : "No verification check has started",
      evidence: phase === "build"
        ? "Build Studio has not dispatched implementation work yet."
        : "Build Studio has not dispatched verification work yet.",
      nextAction: "No action needed unless Build Studio asks for a decision.",
      owner: "Build Studio",
      needsYou: false,
      expectation: "This page will update when work starts. You can leave and return.",
    };
  }

  const failureAxis = progress.statusHeading.failureAxis;
  if (failureAxis) {
    const inconclusive = failureAxis === "unknown" || failureAxis === "out-of-scope-noise";
    return {
      ...status,
      ownerState: inconclusive ? "inconclusive" : "blocked",
      lifecyclePosition: inconclusive ? "Checks need review" : "Work is blocked",
      worker: "Build Studio needs attention before it can continue",
      needsYou: true,
    };
  }

  if (progress.quietAgent.quiet) {
    return {
      ...status,
      ownerState: "blocked",
      lifecyclePosition: "No recent progress",
      worker: "Build Studio may be stuck",
      evidence: `No meaningful progress has been recorded for ${progress.quietAgent.minutesQuiet} minutes.`,
      nextAction: "Review the current step and resume it if needed.",
      owner: "owner",
      needsYou: true,
    };
  }

  return {
    ...status,
    ownerState: ownerStateFromStatus(status),
    ...(!status.needsYou
      ? { expectation: "You can leave this page and return; Build Studio will show the latest recorded state." }
      : {}),
  };
}

function ownerSafeStatusEvidence(value: string): string {
  if (/^Work capsule was abandoned\.$/i.test(value)) return "This work was stopped.";
  if (/^Work capsule reached a completed execution state\.$/i.test(value)) return "This work is complete.";
  if (/^Work capsule is actively executing\.$/i.test(value)) {
    return "Build Studio is working on this change.";
  }
  return value.replace(/\bWork capsule\b/gi, "This work");
}

function ownerStateFromStatus(status: BuildStudioCustomerStatus): BuildStudioOwnerState {
  const durableSummary = [
    status.lifecyclePosition,
    status.worker,
  ].filter(Boolean).join(" ");
  if (/\b(done|deployed|closed|completed|finished)\b/i.test(durableSummary)) return "complete";
  if (/\b(stopped|cancelled|abandoned)\b/i.test(durableSummary)) return "failed";
  if (isWaitingForOwner(status)) return "waiting-owner";
  if (status.needsYou) return "blocked";
  return "working";
}

function isWaitingForOwner(status: BuildStudioCustomerStatus): boolean {
  return status.needsYou
    && /waiting for (?:you|your decision)|needs your decision/i.test(status.lifecyclePosition);
}

function latestInflightDispatch(progress: BuildProgressVisibility) {
  return [...progress.dispatchHistory]
    .filter((attempt) => attempt.completedAt == null)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0] ?? null;
}

function workingStageLabel(phase: BuildPhase): string {
  switch (phase) {
    case "ideate": return "Understanding the change";
    case "plan": return "Planning the change";
    case "build": return "Building the change";
    case "review": return "Checking the change";
    case "ship": return "Preparing the release";
    default: return "Working on the change";
  }
}

function formatElapsedLabel(
  startedAt: string | null,
  generatedAt: string,
  verb: "Working" | "Waiting",
): string | undefined {
  if (!startedAt) return undefined;
  const startMs = new Date(startedAt).getTime();
  const nowMs = new Date(generatedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return undefined;
  const minutes = Math.max(0, Math.floor((nowMs - startMs) / 60_000));
  if (minutes < 1) return `${verb} for less than a minute`;
  if (minutes < 60) return `${verb} for ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? `${verb} for ${hours} ${hours === 1 ? "hour" : "hours"}`
    : `${verb} for ${hours}h ${remainder}m`;
}
