// BI-BB13B599 (EP-WORK-CONVERGENCE): translate a Build Studio build + its linked
// WorkCapsule into a plain, business-safe customer-mode status. Build Studio's
// bands read FeatureBuild.phase directly and are blind to the capsule projection,
// so external Claude/Codex/Grok work carried on the capsule is invisible. This
// pure function reuses the WorkCase projection (projectWorkCaseState) and never
// takes the executor in its signature — business-safety (no "Claude"/"Codex"/
// "Grok" leaking to the customer) is guaranteed by construction.
//
// BI-46204009: the phase/capsule bands above describe *stage*, not *freshness* —
// a build/review-phase build with no recent BuildActivity was still rendered as
// an animated "Working" even after sitting frozen for days (FB-CCEC4210: phase
// build, 0 activity events in ~3.1 days). This module now takes an optional
// `activity` freshness signal and overrides the stage-derived status with an
// honest "Stalled / needs attention" (routed to the Needs-you band) when a
// build/review-phase build has gone quiet longer than the stall threshold.
// Reuses STALLED_BUILD_REAP_MS from inert-build-reaper.ts — that constant's own
// doc comment already calls out that it "matches the UI stall definition,
// BI-46204009" — rather than inventing a second threshold.
//
// Pure + unit-testable. The DB fetch (workCapsule.findFirst by featureBuildId,
// BuildActivity max(createdAt) by the FB-* buildId) and the BuildStudio.tsx
// render are a deferred follow-up (need live-portal verification).

import { projectWorkCaseState } from "@/lib/work-management/status-projection";
import type { WorkCaseState } from "@/lib/work-management/case-types";
import type { BuildPhase } from "@/lib/explore/feature-build-types";
import { STALLED_BUILD_REAP_MS } from "@/lib/build/inert-build-reaper";
import { readBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";

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

/**
 * Phases where the panel currently animates "Working" / "In progress" — the
 * only phases a freshness stall can override. ideate/plan are coworker-custody
 * (age-out is a separate, much longer window — BI-A009313E) and
 * ship/complete/failed/abandoned own their own terminal-ish framing, so a
 * freshness stall only applies to the two phases that actually claim to be
 * live execution. Mirrors the phase gate in isStalledBuildReapable.
 */
const STALL_ELIGIBLE_PHASES: ReadonlySet<BuildPhase> = new Set(["build", "review"]);

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

/**
 * True when a build/review-phase build has produced no observable signal
 * (BuildActivity or a FeatureBuild.updatedAt bump) within the stall threshold.
 * `lastActivityAt` wins when present (it's the more precise signal); falling
 * back to `buildUpdatedAt` covers a build that has never emitted a
 * BuildActivity row at all but whose phase timestamp is stale.
 */
function isActivityStale(args: {
  lastActivityAt: Date | null;
  buildUpdatedAt: Date;
  now: Date;
  staleMs: number;
}): boolean {
  const lastSignal = args.lastActivityAt ?? args.buildUpdatedAt;
  return args.now.getTime() - lastSignal.getTime() > args.staleMs;
}

export function projectBuildStudioCustomerStatus(args: {
  build: { title: string; phase: BuildPhase; updatedAt: Date };
  capsule: { capsuleId: string; status: string; workspaceState?: unknown } | null;
  /** Activity-freshness signal (BI-46204009). Omit to skip the stall check (e.g. existing callers mid-migration). */
  activity?: { lastActivityAt: Date | null; now?: Date };
}): BuildStudioCustomerStatus {
  const delivery = readBuildPrDeliveryState(args.capsule?.workspaceState);
  if (delivery) {
    const base = {
      whatIsBeingBuilt: args.build.title,
      evidence: delivery.lastObservedHeadSha
        ? `Delivery evidence is current at ${delivery.lastObservedHeadSha.slice(0, 12)}.`
        : "Build Studio is gathering current delivery evidence.",
    };
    switch (delivery.status) {
      case "created":
      case "checking":
        return {
          ...base,
          lifecyclePosition: "Checking the pull request",
          worker: "Checking delivery evidence",
          nextAction: "wait while current checks and review evidence finish.",
          owner: "Build Studio",
          needsYou: false,
        };
      case "updating":
        return {
          ...base,
          lifecyclePosition: "Finalizing against the latest platform",
          worker: "Updating the proposed change",
          nextAction: "rerun checks against the updated platform.",
          owner: "Build Studio",
          needsYou: false,
        };
      case "queued":
        return {
          ...base,
          lifecyclePosition: "Merge queued",
          worker: "Repository merge queue",
          nextAction: "wait for the protected merge queue to finish.",
          owner: "Build Studio",
          needsYou: false,
        };
      case "awaiting-release":
        return {
          ...base,
          lifecyclePosition: "Waiting for governed release",
          worker: "Governed release process",
          nextAction: "wait for governed self-upgrade and live-version evidence.",
          owner: "Build Studio",
          needsYou: false,
        };
      case "deployed":
        return {
          ...base,
          lifecyclePosition: "Deployed",
          worker: "Finished",
          nextAction: "review the completed result.",
          owner: "reviewer",
          needsYou: false,
        };
      case "closed":
      case "escalated":
        return {
          ...base,
          lifecyclePosition: "Needs your decision",
          worker: "Waiting for you",
          evidence: delivery.lastError
            ? `Autonomous delivery stopped: ${delivery.lastError}.`
            : "Autonomous delivery stopped safely.",
          nextAction: "review the delivery issue and decide how to continue.",
          owner: "human decision-maker",
          needsYou: true,
        };
    }
  }

  const base: BuildStudioCustomerStatus = args.capsule
    ? (() => {
        const projection = projectWorkCaseState({ capsule: args.capsule! });
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
      })()
    : // No capsule linked yet: degrade to a phase-only plain status.
      (() => {
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
      })();

  // BI-46204009: a build/review-phase build that isn't already flagged
  // needs-you but has gone quiet longer than the stall threshold is not
  // honestly "Working" — override with a stalled status and route to Needs-you.
  if (
    args.activity &&
    !base.needsYou &&
    STALL_ELIGIBLE_PHASES.has(args.build.phase) &&
    isActivityStale({
      lastActivityAt: args.activity.lastActivityAt,
      buildUpdatedAt: args.build.updatedAt,
      now: args.activity.now ?? new Date(),
      staleMs: STALLED_BUILD_REAP_MS,
    })
  ) {
    const lastSignal = args.activity.lastActivityAt ?? args.build.updatedAt;
    return {
      ...base,
      lifecyclePosition: "Stalled / needs attention",
      worker: "Stalled — needs attention",
      evidence: `No build activity since ${lastSignal.toISOString()} (stall threshold ${Math.round(STALLED_BUILD_REAP_MS / 3_600_000)}h).`,
      nextAction: "check the build and resume or abandon it if it's stuck.",
      owner: "Build Studio / operator",
      needsYou: true,
    };
  }

  return base;
}
