// BI-BB13B599 (EP-WORK-CONVERGENCE): translate a Build Studio build + its linked
// WorkCapsule into a plain, business-safe customer-mode status. Build Studio's
// bands read FeatureBuild.phase directly and are blind to the capsule projection,
// so external Claude/Codex/Grok work carried on the capsule is invisible. This
// pure function reuses the WorkCase projection (projectWorkCaseState) and never
// takes the executor in its signature — business-safety (no "Claude"/"Codex"/
// "Grok" leaking to the customer) is guaranteed by construction.
//
// Pure + unit-testable. The DB fetch (workCapsule.findFirst by featureBuildId)
// and the BuildStudio.tsx render are a deferred follow-up (need live-portal
// verification).

import { projectWorkCaseState } from "@/lib/work-management/status-projection";
import type { WorkCaseState } from "@/lib/work-management/case-types";
import type { BuildPhase } from "@/lib/explore/feature-build-types";

export interface BuildStudioCustomerStatus {
  /** Plain restatement of what is being built (the build title). */
  whatIsBeingBuilt: string;
  /** Plain-language lifecycle position, safe for a nontechnical requester. */
  lifecyclePosition: string;
  /** Who/what is working, translated to business-safe language — never an executor name. */
  worker: string;
  /** True when the work is waiting on the human (surfaces "Needs you"). */
  needsYou: boolean;
}

const NEEDS_YOU_STATES: ReadonlySet<WorkCaseState> = new Set([
  "waiting-on-person",
  "awaiting-decision",
  "waiting-on-system",
]);

/** Capsule-derived WorkCaseState → plain lifecycle label. */
const STATE_PLAIN: Record<WorkCaseState, string> = {
  intake: "Getting started",
  triage: "Getting started",
  active: "In progress",
  "waiting-on-person": "Waiting for you",
  "waiting-on-system": "Automated work in progress",
  "awaiting-decision": "Waiting for your decision",
  verifying: "Checking the work",
  resolved: "Done",
  closed: "Closed",
  cancelled: "Stopped",
};

/** Phase-only fallback label when no capsule is linked yet. */
const PHASE_PLAIN: Record<BuildPhase, string> = {
  ideate: "Figuring out what to build",
  plan: "Planning the work",
  build: "Building it",
  review: "Reviewing the work",
  ship: "Getting ready to ship",
  complete: "Done",
  failed: "Hit a problem",
  abandoned: "Stopped",
};

/** Business-safe worker phrasing — deliberately never names Claude/Codex/Grok. */
function workerLabel(state: WorkCaseState): string {
  switch (state) {
    case "waiting-on-system":
      return "Automated build in progress";
    case "active":
      return "Work in progress";
    case "verifying":
      return "Reviewing the work";
    case "waiting-on-person":
    case "awaiting-decision":
      return "Waiting for you";
    case "resolved":
    case "closed":
      return "Finished";
    case "cancelled":
      return "Stopped";
    default:
      return "Getting started";
  }
}

export function projectBuildStudioCustomerStatus(args: {
  build: { title: string; phase: BuildPhase };
  capsule: { capsuleId: string; status: string } | null;
}): BuildStudioCustomerStatus {
  if (args.capsule) {
    const projection = projectWorkCaseState({ capsule: args.capsule });
    return {
      whatIsBeingBuilt: args.build.title,
      lifecyclePosition: STATE_PLAIN[projection.state],
      worker: workerLabel(projection.state),
      needsYou: NEEDS_YOU_STATES.has(projection.state),
    };
  }

  // No capsule linked yet: degrade to a phase-only plain status.
  return {
    whatIsBeingBuilt: args.build.title,
    lifecyclePosition: PHASE_PLAIN[args.build.phase],
    worker:
      args.build.phase === "complete"
        ? "Finished"
        : args.build.phase === "failed"
          ? "Hit a problem"
          : "Work in progress",
    needsYou: args.build.phase === "failed",
  };
}
