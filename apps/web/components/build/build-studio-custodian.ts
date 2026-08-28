import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import type { Intent } from "@/components/ui/report-kit";
import { isAwaitingOwnerDecision } from "@/lib/build/owner-decision-pending";
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
  failedInference: boolean;
  isQuietReview: boolean;
  isQuietBuild: boolean;
  isQuietEarlyPhase: boolean;
  emptyDiff: boolean;
}): NonNullable<ProactivityResolverInput["statusSignal"]> {
  if (
    input.uxReviewGap
    || input.blockedByEvidence
    || input.technicalRecovery
    || input.failedInference
    || input.emptyDiff
  ) {
    return "blocked";
  }
  if (input.isQuietReview || input.isQuietBuild || input.isQuietEarlyPhase) {
    return "stalled";
  }
  return "normal";
}

/**
 * True when the build has no deployable source changes (BI-9C66860E).
 * Pure — null/whitespace-only patch and summary both count as empty.
 */
export function hasNoReleasableDiff(
  build: Pick<FeatureBuildRow, "diffPatch" | "diffSummary">,
): boolean {
  const patch = build.diffPatch?.trim() ?? "";
  const summary = build.diffSummary?.trim() ?? "";
  return patch.length === 0 && summary.length === 0;
}

/**
 * True when the system should surface the empty-diff honest card instead of a
 * generic "gone quiet" state (EP-BS-UX-HARDENING invariant 5 / BI-9C66860E).
 * Mid-coding builds with no patch are excluded unless quiet, or past coding.
 */
export function isEmptyDiffHonestOutcome(args: {
  build: FeatureBuildRow;
  progressVisibility?: BuildProgressVisibility | null;
}): boolean {
  const { build, progressVisibility } = args;
  if (!hasNoReleasableDiff(build)) return false;
  if (build.phase === "ideate" || build.phase === "plan" || build.phase === "complete" || build.phase === "abandoned") {
    return false;
  }
  // Ship with nothing to deploy is the classic deploy_feature refuse path.
  if (build.phase === "ship") {
    return true;
  }
  const quiet = progressVisibility?.quietAgent.quiet === true;
  // Review: only when quiet (would otherwise show generic quiet) or UX already
  // passed (coding finished, deploy path next) — not while UX/evidence is the
  // active blocker (those cards take precedence).
  if (build.phase === "review") {
    // "complete" is the successful UX verification terminal (see FeatureBuildRow).
    const uxPassed = build.uxVerificationStatus === "complete";
    return quiet || uxPassed;
  }
  // build phase: only after coding has gone quiet or the exec step is terminalish
  if (build.phase === "build") {
    const step = (build.buildExecState as { step?: string } | null)?.step ?? null;
    const terminalish =
      step === "complete"
      || step === "failed"
      || step === "ship_blocked"
      || step === "deploy_failed";
    return quiet || terminalish;
  }
  return false;
}

export function deriveBuildStudioCustodianPrompt({
  build,
  action,
  progressVisibility,
}: CustodianPromptInput): BuildStudioCustodianPrompt | null {
  const emptyDiff = isEmptyDiffHonestOutcome({ build, progressVisibility });

  // Terminal phases the custodian must never nudge on — except empty-diff ship
  // (BI-9C66860E), a definitive terminal outcome that must not look healthy.
  // "abandoned" (BI-A2F3FA9D) is an escalate-to-human handoff: WIP is freed and
  // the originating BI parked as "deferred", so there is nothing to keep moving
  // here — a nudge would be noise. "failed" is intentionally NOT excluded: it
  // retains a live retry-build recovery path the custodian's technicalRecovery
  // branch surfaces on purpose.
  if (
    (build.phase === "complete" || build.phase === "ship" || build.phase === "abandoned")
    && !emptyDiff
  ) {
    return null;
  }

  const guidance = deriveBuildStudioOperatorGuidance(action, build);
  if (
    !emptyDiff
    && guidance.status.kind === "working"
    && progressVisibility?.quietAgent.quiet !== true
  ) {
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
  if (isAwaitingOwnerDecision(action.kind)) return null; // BI-C35F1FED
  const blockedByEvidence = action.disabledReason != null;
  const technicalRecovery =
    action.kind === "resume-implementation"
    || action.kind === "rerun-plan-review"
    || action.kind === "retry-build"
    || action.kind === "reset-build";
  // BI-F0005EB0 — the AI call itself errored (failed ideate/scout inference).
  // This is a distinct danger state, NOT the benign "Waiting on evidence".
  const failedInference = action.kind === "retry-inference";
  const uxReviewGap = isUxReviewGap(build, action, progressVisibility);

  if (
    !emptyDiff
    && !uxReviewGap
    && !blockedByEvidence
    && !technicalRecovery
    && !failedInference
    && !isQuietReview
    && !isQuietBuild
    && !isQuietEarlyPhase
  ) {
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
      failedInference,
      isQuietReview,
      isQuietBuild,
      isQuietEarlyPhase,
      emptyDiff,
    }),
  });

  // UX evidence gap stays ahead of empty-diff: a failed/missing UX check is a
  // more specific next action than "no releasable diff" when both could apply.
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

  if (failedInference) {
    // BI-F0005EB0 — the AI call errored (e.g. ideate/scout inference failed to
    // connect). Present it honestly as a failed call the AI must retry, NOT as
    // the human owing evidence. Details use provider-detail-free copy carried on
    // the action; the raw provider error never reaches the user here.
    return {
      dismissKey,
      title: "The AI call failed.",
      whyNow:
        "The last AI response could not complete — the request errored, so this build is waiting on a retry, not on you.",
      recommendedAction:
        "Retry the AI call. I will keep watching and pick it up automatically if it fails again.",
      primaryLabel: action.primaryLabel ?? "Retry the AI call",
      primaryAction: "workflow",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. The AI call failed to complete. Retry it, and if it keeps failing explain the likely cause in plain English and give the human exactly one next action.",
      ),
      statusLabel: "AI call failed",
      intent: "danger",
      details: [
        action.message,
        "This is a failed AI call, not a missing input from you. Retrying re-runs the same request.",
      ].filter(Boolean),
      proactivityPlan,
    };
  }

  // Empty-diff (BI-9C66860E) is more specific than generic technical recovery
  // when the retry/reset path is only available because coding produced no
  // releasable bytes — lead with the honest outcome, still keep workflow CTA.
  if (emptyDiff && (action.kind === "retry-build" || action.kind === "reset-build" || action.kind === "resume-implementation")) {
    return {
      dismissKey: `${dismissKey}:empty-diff`,
      title: "This build finished without changes to deploy.",
      whyNow:
        "The AI completed its pass but did not produce any source changes — there is nothing to release from this run.",
      recommendedAction:
        "Retry the build from the current brief, or refine the description so the next pass has a clearer target.",
      primaryLabel: action.primaryLabel ?? "Retry build",
      primaryAction: "workflow",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. This build has no releasable diff. Explain that in plain English, offer Retry build or refine the brief, and do not claim work is still moving.",
      ),
      statusLabel: "No changes to deploy",
      intent: "warning",
      details: [
        "Deploy correctly refused because there was no releasable source diff.",
        "This is not an indefinite quiet state — the outcome is known: zero deployable changes from this run.",
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
        "Act as the Build Studio custodian. Explain the recovery in plain English and keep the owner to one next action.",
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
      // BI-0F7C855A: the soothing "getting started" card is only honest while
      // the drafting turn is genuinely young. Without a time bound it shadowed
      // the early-phase quiet detection (BI-97738ED0) FOREVER — a build whose
      // drafting turn died showed "Nothing is wrong" indefinitely (observed
      // live: 46 idle minutes on FB-673BF54B). Past the quiet bar, surface the
      // stall honestly and offer to restart the drafting turn.
      if (isQuietEarlyPhase) {
        return {
          dismissKey,
          title: "Drafting your Feature Brief has stalled.",
          whyNow: `I have not seen drafting progress for ${formatMinutes(quietMinutes)}. Something interrupted the coworker — this needs a restart, not more waiting.`,
          recommendedAction: "Restart the brief drafting now. Your description is preserved; you do not need to add anything unless you want to.",
          primaryLabel: action.coworkerLabel,
          primaryAction: "coworker",
          coworkerPrompt: appendCustodianInstruction(
            action,
            "Act as the Build Studio custodian. Brief drafting stalled — continue drafting the Feature Brief from the user's description and any saved scout findings, save it with saveBuildEvidence, and reply with one next action.",
          ),
          statusLabel: "Stalled",
          intent: "warning",
          details: [
            "The build sat in the defining step past the quiet threshold with no progress signal.",
            "Restarting the drafting turn re-runs the coworker; nothing you wrote is lost.",
          ],
          proactivityPlan,
        };
      }
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
          "The owner should see the conclusion and one next action, not raw workflow internals.",
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
        "The owner should see the conclusion and one next action, not raw workflow internals.",
      ],
      proactivityPlan,
    };
  }

  // BI-9C66860E — a definitive empty-diff outcome beats generic quiet copy
  // (EP-BS-UX-HARDENING invariant 5). Recovery kinds already returned above.
  if (emptyDiff) {
    return {
      dismissKey: `${dismissKey}:empty-diff`,
      title: "This build finished without changes to deploy.",
      whyNow:
        "The AI completed its pass but did not produce any source changes — there is nothing to release from this run.",
      recommendedAction:
        "Retry the build from the current brief, or refine the description so the next pass has a clearer target.",
      primaryLabel: "Retry build",
      primaryAction: "coworker",
      coworkerPrompt: appendCustodianInstruction(
        action,
        "Act as the Build Studio custodian. This build has no releasable diff. Explain that in plain English, offer Retry build or refine the brief, and do not claim work is still moving.",
      ),
      statusLabel: "No changes to deploy",
      intent: "warning",
      details: [
        "Deploy correctly refused because there was no releasable source diff.",
        "This is not an indefinite quiet state — the outcome is known: zero deployable changes from this run.",
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
