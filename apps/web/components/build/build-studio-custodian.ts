import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { Intent } from "@/components/ui/report-kit";
import { resolveProactivityPlan } from "@/lib/proactivity/proactivity-resolver";
import type { ProactivityPlan, ProactivityResolverInput } from "@/lib/proactivity/proactivity-types";
import {
  deriveBuildStudioOperatorGuidance,
  type BuildStudioWorkflowAction,
} from "./build-studio-workflow-actions";

export type BuildStudioCustodianPrimaryAction = "workflow" | "coworker";

export type BuildStudioCustodianPrompt = {
  dismissKey: string;
  title: string;
  whyNow: string;
  recommendedAction: string;
  primaryLabel: string;
  primaryAction: BuildStudioCustodianPrimaryAction;
  coworkerPrompt: string;
  statusLabel: string;
  intent: Intent;
  details: string[];
  proactivityPlan: ProactivityPlan;
};

type CustodianPromptInput = {
  build: FeatureBuildRow;
  action: BuildStudioWorkflowAction;
  progressVisibility?: BuildProgressVisibility | null;
};

const QUIET_REVIEW_THRESHOLD_MINUTES = 5;
const QUIET_BUILD_THRESHOLD_MINUTES = 10;
// Early phases (ideate / plan) had no quiet threshold at all, so a build that
// died before producing a brief — the most common failure window — surfaced no
// custodian nudge and read as "Needs you: 0". Give it the same 5-minute quiet
// bar as review so a stalled ideate/plan build is not invisible.
const QUIET_EARLY_PHASE_THRESHOLD_MINUTES = 5;

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "less than a minute";
  if (minutes === 1) return "1 minute";
  return `${minutes} minutes`;
}

function appendCustodianInstruction(action: BuildStudioWorkflowAction, instruction: string): string {
  return `${action.coworkerPrompt}\n\n${instruction}`;
}

function buildDismissKey(
  build: FeatureBuildRow,
  action: BuildStudioWorkflowAction,
  progressVisibility?: BuildProgressVisibility | null,
): string {
  const signal =
    progressVisibility?.quietAgent.lastObservableSignalAt
    ?? build.updatedAt.toISOString();
  return [
    build.buildId,
    build.phase,
    action.kind,
    build.uxVerificationStatus ?? "ux-unknown",
    signal,
  ].join(":");
}

function isUxReviewGap(
  build: FeatureBuildRow,
  action: BuildStudioWorkflowAction,
  progressVisibility?: BuildProgressVisibility | null,
): boolean {
  if (build.phase !== "review" || action.kind !== "run-review-verification") {
    return false;
  }

  return (
    build.uxVerificationStatus === "failed"
    || (
      build.uxVerificationStatus == null
      && progressVisibility?.quietAgent.quiet === true
      && progressVisibility.quietAgent.minutesQuiet >= QUIET_REVIEW_THRESHOLD_MINUTES
    )
  );
}

function resolveCustodianStatusSignal(input: {
  uxReviewGap: boolean;
  blockedByEvidence: boolean;
  technicalRecovery: boolean;
  isQuietReview: boolean;
  isQuietBuild: boolean;
  isQuietEarlyPhase: boolean;
}): NonNullable<ProactivityResolverInput["statusSignal"]> {
  if (input.uxReviewGap || input.blockedByEvidence || input.technicalRecovery) {
    return "blocked";
  }
  if (input.isQuietReview || input.isQuietBuild || input.isQuietEarlyPhase) {
    return "stalled";
  }
  return "normal";
}

export function deriveBuildStudioCustodianPrompt({
  build,
  action,
  progressVisibility,
}: CustodianPromptInput): BuildStudioCustodianPrompt | null {
  // Terminal phases the custodian must never nudge on. "abandoned" (BI-A2F3FA9D)
  // is an escalate-to-human handoff: WIP is freed and the originating BI parked
  // as "deferred", so there is nothing to keep moving here — a nudge would be
  // noise. "failed" is intentionally NOT excluded: it retains a live retry-build
  // recovery path the custodian's technicalRecovery branch surfaces on purpose.
  if (build.phase === "complete" || build.phase === "ship" || build.phase === "abandoned") {
    return null;
  }

  const guidance = deriveBuildStudioOperatorGuidance(action, build);
  if (guidance.status.kind === "working" && progressVisibility?.quietAgent.quiet !== true) {
    return null;
  }

  const quietMinutes = progressVisibility?.quietAgent.minutesQuiet ?? 0;
  const isQuietReview =
    build.phase === "review"
    && progressVisibility?.quietAgent.quiet === true
    && quietMinutes >= QUIET_REVIEW_THRESHOLD_MINUTES;
  const isQuietBuild =
    build.phase === "build"
    && progressVisibility?.quietAgent.quiet === true
    && quietMinutes >= QUIET_BUILD_THRESHOLD_MINUTES;
  const isQuietEarlyPhase =
    (build.phase === "ideate" || build.phase === "plan")
    && progressVisibility?.quietAgent.quiet === true
    && quietMinutes >= QUIET_EARLY_PHASE_THRESHOLD_MINUTES;
  const blockedByEvidence = action.disabledReason != null;
  const technicalRecovery =
    action.kind === "resume-implementation"
    || action.kind === "rerun-plan-review"
    || action.kind === "retry-build"
    || action.kind === "reset-build";
  const uxReviewGap = isUxReviewGap(build, action, progressVisibility);

  if (!uxReviewGap && !blockedByEvidence && !technicalRecovery && !isQuietReview && !isQuietBuild && !isQuietEarlyPhase) {
    return null;
  }

  const dismissKey = buildDismissKey(build, action, progressVisibility);
  const proactivityPlan = resolveProactivityPlan({
    activityFamily: "build-studio-custodian",
    agentId: build.claimedByAgentId,
    routeContext: "/build",
    statusSignal: resolveCustodianStatusSignal({
      uxReviewGap,
      blockedByEvidence,
      technicalRecovery,
      isQuietReview,
      isQuietBuild,
      isQuietEarlyPhase,
    }),
  });

  if (uxReviewGap) {
    return {
      dismissKey,
      title: "I can keep this review moving.",
      whyNow: build.uxVerificationStatus === "failed"
        ? "UX verification still needs clean evidence, so another quiet click can look like nothing happened."
        : `This review has been quiet for ${formatMinutes(quietMinutes)} while UX evidence is still missing.`,
      recommendedAction: "I can collect the acceptance evidence, rerun the review path if needed, and report the one next decision.",
      primaryLabel: "Let AI Coworker handle it",
      primaryAction: "coworker",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. Check the UX verification and acceptance evidence, take the safest in-place recovery available, and come back with exactly one next action for the human.",
      ),
      statusLabel: "Needs evidence",
      intent: "warning",
      details: [
        "The review is not ready to release until UX evidence and acceptance evidence agree.",
        "If the retry already started work, wait for that evidence first. If it did not, use the existing Build Studio recovery path instead of asking the human to diagnose logs.",
      ],
      proactivityPlan,
    };
  }

  if (technicalRecovery) {
    return {
      dismissKey,
      title: "I found the recovery path.",
      whyNow: guidance.guidedRecovery
        ? "This stop has a guided repair, so you should not have to investigate technical details first."
        : "The build is technically blocked, and the safest next step is already available here.",
      recommendedAction: guidance.guidedRecovery
        ? "Try the guided fix now. I will keep watching the result."
        : "Restart the stuck step from Build Studio. I will keep watching the result.",
      primaryLabel: action.primaryLabel ?? "Try to fix",
      primaryAction: "workflow",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. Explain the recovery in plain English and keep the human to one next action.",
      ),
      statusLabel: "Blocked",
      intent: "danger",
      details: [
        action.message,
        guidance.recoveryHint ?? "Use the in-place recovery first; escalate only if it cannot make progress.",
      ].filter(Boolean),
      proactivityPlan,
    };
  }

  if (blockedByEvidence) {
    // A brand-new build in ideate that has not produced its Feature Brief yet is
    // not "missing evidence" — it is simply still being defined. Reusing the
    // alarming "required evidence is missing" copy here reads as an error on the
    // normal first step (and contradicts the panel telling the user to describe
    // the feature). Surface an honest "getting started" state instead.
    if (build.phase === "ideate" && build.brief == null) {
      return {
        dismissKey,
        title: "Let's get this build started.",
        whyNow: "This build is still being defined — the coworker is drafting your Feature Brief from your description. Nothing is wrong.",
        recommendedAction: "Add any detail in the conversation panel, or let the coworker keep drafting the brief.",
        primaryLabel: action.coworkerLabel,
        primaryAction: "coworker",
        coworkerPrompt: appendCustodianInstruction(
          action,
          "Act as the Build Studio custodian. Draft the Feature Brief from the user's description and return one next action.",
        ),
        statusLabel: "Getting started",
        intent: "info",
        details: [
          "The build is being defined from your description; no evidence is missing yet.",
          "The human should see the conclusion and one next action, not raw workflow internals.",
        ],
        proactivityPlan,
      };
    }
    return {
      dismissKey,
      title: "I can collect what is missing.",
      whyNow: "This build is waiting because required evidence is missing, not because you need to read the technical detail.",
      recommendedAction: "Let the AI Coworker collect the missing evidence and return with the next release decision.",
      primaryLabel: action.coworkerLabel,
      primaryAction: "coworker",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. Collect the missing evidence from the existing Build Studio surfaces and return with one next action.",
      ),
      statusLabel: "Waiting on evidence",
      intent: "accent",
      details: [
        action.disabledReason ?? "Required evidence is missing.",
        "The human should see the conclusion and one next action, not raw workflow internals.",
      ],
      proactivityPlan,
    };
  }

  return {
    dismissKey,
    title: "This build has gone quiet.",
    whyNow: `I have not seen a fresh progress signal for ${formatMinutes(quietMinutes)}.`,
    recommendedAction: "I can check whether work is still moving and come back with the next action only if one is needed.",
    primaryLabel: "Ask AI Coworker to check",
    primaryAction: "coworker",
    coworkerPrompt: appendCustodianInstruction(
      action,
      "Act as the Build Studio custodian. Check whether this build is still making progress. If it is healthy, say so briefly. If not, take the safest available recovery or return one next action.",
    ),
    statusLabel: "Quiet",
    intent: "info",
    details: [
      "The surface should stay quiet while work progresses.",
      "A quiet build only interrupts when the next step is useful for keeping delivery moving.",
    ],
    proactivityPlan,
  };
}
