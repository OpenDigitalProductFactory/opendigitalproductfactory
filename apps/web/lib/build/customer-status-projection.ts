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
  /** Plain evidence behind the status, safe for customer/operator display. */
  evidence: string;
  /** One concrete next action that moves the work forward. */
  nextAction: string;
  /** The accountable owner for the next action. */
  owner: string;
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

function nextActionForState(state: WorkCaseState): { nextAction: string; owner: string } {
  switch (state) {
    case "waiting-on-person":
    case "awaiting-decision":
      return {
        nextAction: "answer the requested decision so the work can continue.",
        owner: "human decision-maker",
      };
    case "waiting-on-system":
      return {
        nextAction: "clear the system or runtime blocker, then resume the build.",
        owner: "Build Studio / operator",
      };
    case "verifying":
      return {
        nextAction: "finish verification and record the result.",
        owner: "Build Studio review agent",
      };
    case "resolved":
    case "closed":
      return {
        nextAction: "review the completed work and promote or merge it if accepted.",
        owner: "reviewer",
      };
    case "cancelled":
      return {
        nextAction: "restart the work only if the business priority still stands.",
        owner: "human decision-maker",
      };
    case "intake":
    case "triage":
      return {
        nextAction: "finish scoping the request and confirm it is ready to build.",
        owner: "Build Studio",
      };
    case "active":
    default:
      return {
        nextAction: "continue implementation until verification evidence is ready.",
        owner: "Build Studio build agent",
      };
  }
}

function nextActionForPhase(phase: BuildPhase): { nextAction: string; owner: string } {
  switch (phase) {
    case "ideate":
      return { nextAction: "finish the design brief and review it.", owner: "Build Studio ideate agent" };
    case "plan":
      return { nextAction: "draft and review the implementation plan.", owner: "Build Studio planning agent" };
    case "build":
      return { nextAction: "continue implementation until verification evidence is ready.", owner: "Build Studio build agent" };
    case "review":
      return { nextAction: "finish tests, UX checks, and acceptance review.", owner: "Build Studio review agent" };
    case "ship":
      return { nextAction: "complete the PR or promotion handoff.", owner: "Build Studio ship agent" };
    case "complete":
      return { nextAction: "review the completed work and promote or merge it if accepted.", owner: "reviewer" };
    case "failed":
      return { nextAction: "resolve the failure and rerun the affected phase.", owner: "Build Studio / operator" };
    case "abandoned":
    default:
      return { nextAction: "restart the work only if the business priority still stands.", owner: "human decision-maker" };
  }
}

export function projectBuildStudioCustomerStatus(args: {
  build: { title: string; phase: BuildPhase };
  capsule: { capsuleId: string; status: string } | null;
}): BuildStudioCustomerStatus {
  if (args.capsule) {
    const projection = projectWorkCaseState({ capsule: args.capsule });
    const action = nextActionForState(projection.state);
    return {
      whatIsBeingBuilt: args.build.title,
      lifecyclePosition: STATE_PLAIN[projection.state],
      worker: workerLabel(projection.state),
      evidence: projection.reason,
      nextAction: action.nextAction,
      owner: action.owner,
      needsYou: NEEDS_YOU_STATES.has(projection.state),
    };
  }

  // No capsule linked yet: degrade to a phase-only plain status.
  const action = nextActionForPhase(args.build.phase);
  return {
    whatIsBeingBuilt: args.build.title,
    lifecyclePosition: PHASE_PLAIN[args.build.phase],
    worker:
      args.build.phase === "complete"
        ? "Finished"
        : args.build.phase === "failed"
          ? "Hit a problem"
          : "Work in progress",
    evidence: `Build Studio phase is ${args.build.phase}.`,
    nextAction: action.nextAction,
    owner: action.owner,
    needsYou: args.build.phase === "failed",
  };
}
