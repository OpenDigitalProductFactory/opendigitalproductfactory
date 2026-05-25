import {
  checkPhaseGate,
  normalizeHappyPathState,
  type BuildPhase,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";
import { normalizeTaskResults, type NormalizedTaskResult, type NormalizedTaskResults } from "@/lib/build/task-results";
import {
  classifyVerificationFailureAxis,
  normalizeVerificationOutput,
  type NormalizedVerificationOutput,
} from "@/lib/build/verification-output";
import { derivePlanOscillationDecompositionAffordance } from "@/lib/build/plan-oscillation-decomposition";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import type {
  BuildFailureAxis,
  ResumeImplementationModeDetail,
  TruthNumericSnapshot,
} from "@/lib/build/progress-visibility-types";

type BuildStudioWorkflowActionMetadata = {
  failureAxis?: BuildFailureAxis | null;
  truthSources?: TruthNumericSnapshot[];
  resumeMode?: ResumeImplementationModeDetail;
};

export type BuildStudioWorkflowAction =
  | ({
    kind: "approve-start";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "advance-phase";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: BuildPhase;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "run-review-verification";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "record-acceptance";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "retry-build";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    // FB-78E967D4 — Reset Build affordance. Surfaces when the pipeline left
    // FeatureBuild.buildExecState in a self-contradictory shape that the
    // existing retry/resume paths refuse to handle (e.g. step=complete with a
    // lingering error/failedAt from a partial run). PR #859 prevents new
    // builds from reaching this shape going forward; this affordance is the
    // UX recovery path for rows that hit the bug before the forward-going fix
    // landed. The action clears buildExecState and re-fires autoExecuteBuild
    // so the pipeline can self-heal from a clean checkpoint.
    kind: "reset-build";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "resume-implementation";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "decompose-now";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "amend-parent-design";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata)
  | ({
    kind: "review-only";
    title: string;
    message: string;
    primaryLabel: string | null;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  } & BuildStudioWorkflowActionMetadata);

export type WorkflowStageGuidance = {
  title: string;
  nextApproval: string;
  workflowAction: BuildStudioWorkflowAction;
};

type ActionInput = {
  build: FeatureBuildRow;
  governedBacklogEnabled: boolean;
  progressVisibility?: BuildProgressVisibility | null;
};

type StageGuidanceInput = ActionInput & {
  phase: BuildPhase;
  workflowLabel: string | null;
};

function isApprovalManagedBacklogBuild(
  build: FeatureBuildRow,
  governedBacklogEnabled: boolean,
): boolean {
  return build.originator != null && (governedBacklogEnabled || build.originatingBacklogItemId != null);
}

function getPhaseGateReason(
  build: FeatureBuildRow,
  targetPhase: BuildPhase,
): string | null {
  const gate = checkPhaseGate(build.phase, targetPhase, {
    designDoc: build.designDoc,
    designReview: build.designReview,
    happyPathState: normalizeHappyPathState(build.happyPathState),
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    taskResults: build.taskResults,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
    uxTestResults: build.uxTestResults,
    uxVerificationStatus: build.uxVerificationStatus,
    acceptanceCriteria: build.brief?.acceptanceCriteria ?? [],
  });

  return gate.allowed ? null : (gate.reason ?? "This phase cannot advance yet.");
}

function describeApprovalGap(build: FeatureBuildRow): string {
  if (build.phase === "ideate") {
    return "This linked backlog build still needs a recorded human start approval before Build Studio should move into planning.";
  }

  return "This linked backlog build reached planning without a recorded start approval. Record the approval in Build Studio now so the governance trail reflects the approval that should have happened before planning.";
}

type ImplementationConcernState = {
  taskResults: NormalizedTaskResults;
  verification: NormalizedVerificationOutput;
  nonCleanTasks: NormalizedTaskResult[];
  failureAxis: BuildFailureAxis | null;
  operatorAction: string | null;
  resumeMode: ResumeImplementationModeDetail;
  hasRecoverableConcern: boolean;
  truthSources: TruthNumericSnapshot[];
};

function getImplementationConcernState(
  build: FeatureBuildRow,
  progressVisibility: BuildProgressVisibility | null | undefined,
): ImplementationConcernState {
  const taskResults = progressVisibility?.tasks ?? normalizeTaskResults(build.taskResults);
  const verification = normalizeVerificationOutput(build.verificationOut);
  const nonCleanTasks = taskResults.tasks.filter((task) => task.outcome !== "DONE");
  const explicitFailureAxis = explicitFailureAxisOrNull(build.verificationOut);
  const verificationFailed =
    verification.typecheckPassed === false
    || explicitFailureAxis != null;
  const failureAxis =
    progressVisibility?.statusHeading.failureAxis
    ?? deriveFailureAxis(nonCleanTasks, verification, explicitFailureAxis);
  const resumeMode = deriveResumeMode({
    build,
    taskResults,
    nonCleanTasks,
    verificationFailed,
  });

  return {
    taskResults,
    verification,
    nonCleanTasks,
    failureAxis,
    operatorAction: progressVisibility?.statusHeading.operatorAction ?? null,
    resumeMode,
    hasRecoverableConcern: nonCleanTasks.length > 0 || verificationFailed,
    truthSources: [progressVisibility?.progress.primary ?? taskResults.source],
  };
}

function deriveFailureAxis(
  nonCleanTasks: NormalizedTaskResult[],
  verification: NormalizedVerificationOutput,
  explicitFailureAxis: BuildFailureAxis | null,
): BuildFailureAxis | null {
  for (const task of nonCleanTasks) {
    const axis = classifyVerificationFailureAxis({
      typecheckPassed: null,
      testsFailed: null,
      output: task.summary,
    });
    if (axis) {
      return axis;
    }
  }

  return explicitFailureAxis ?? verification.failureAxis;
}

function explicitFailureAxisOrNull(value: unknown): BuildFailureAxis | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const failureAxis = (value as { failureAxis?: unknown }).failureAxis;
  if (typeof failureAxis !== "string") {
    return null;
  }
  return (
    failureAxis === "rate-limit"
    || failureAxis === "usage-limit"
    || failureAxis === "auth"
    || failureAxis === "timeout"
    || failureAxis === "test-failure"
    || failureAxis === "typecheck-failure"
    || failureAxis === "out-of-scope-noise"
    || failureAxis === "provider-unavailable"
    || failureAxis === "unknown"
  ) ? failureAxis : null;
}

function deriveResumeMode(args: {
  build: FeatureBuildRow;
  taskResults: NormalizedTaskResults;
  nonCleanTasks: NormalizedTaskResult[];
  verificationFailed: boolean;
}): ResumeImplementationModeDetail {
  if (args.nonCleanTasks.length > 0) {
    const count = args.nonCleanTasks.length;
    return {
      mode: "reset-blocked",
      label: "Reset blocked tasks",
      reason: `${count} non-clean task${count === 1 ? "" : "s"} will be reset before the existing resume path is queued.`,
    };
  }

  if (args.build.phase === "review" && args.verificationFailed) {
    return {
      mode: "rerun-verification",
      label: "Rerun verification",
      reason: "Review has failed verification evidence but no blocked task rows, so the recovery path reopens verification from the existing build state.",
    };
  }

  if (args.taskResults.tasks.length === 0) {
    return {
      mode: "replan-and-dispatch",
      label: "Re-plan and dispatch",
      reason: "No persisted task rows exist, so the existing resume path must dispatch from the current plan.",
    };
  }

  return {
    mode: "already-running",
    label: "Already running",
    reason: "The build already has observable implementation state; wait for the next dispatch, database write, or activity row.",
  };
}

function buildResumeAction(args: {
  state: ImplementationConcernState;
  coworkerLabel: string;
  coworkerPrompt: string;
}): BuildStudioWorkflowAction {
  const { state } = args;
  const blockedCount = state.nonCleanTasks.length;
  const axis = state.failureAxis ?? "unknown";
  const title =
    state.operatorAction
      ? state.operatorAction
      : axis === "out-of-scope-noise"
      ? "Review workspace noise before retrying this build"
      : blockedCount > 0
        ? `Click Resume to re-execute ${blockedCount} blocked task${blockedCount === 1 ? "" : "s"}`
        : state.resumeMode.mode === "replan-and-dispatch"
          ? "Click Resume to re-plan and dispatch tasks"
          : "Click Resume to rerun verification";
  const message =
    axis === "out-of-scope-noise"
      ? "Failure axis: out-of-scope-noise. Verification failures appear to come from outside this build's source surface; review the scoped evidence before retrying."
      : `Failure axis: ${axis}. ${state.resumeMode.reason} Resume from a healthy sandbox before review continues.`;

  return {
    kind: "resume-implementation",
    title,
    message,
    primaryLabel: "Resume Implementation",
    targetPhase: null,
    disabledReason: null,
    coworkerLabel: args.coworkerLabel,
    coworkerPrompt: args.coworkerPrompt,
    failureAxis: state.failureAxis,
    truthSources: state.truthSources,
    resumeMode: state.resumeMode,
  };
}

/**
 * FB-78E967D4 — detect a buildExecState shape that no existing recovery path
 * accepts:
 *   - `retryBuildExecution` rejects unless `state.step === "failed"`.
 *   - `resumeBuildImplementation` rejects unless a releasable diff exists.
 *   - The phase-gate `advance-phase` action surfaces but is disabled because
 *     `verificationOut` is null.
 *
 * The canonical failure mode is FB-F0476EF3: a step threw mid-run on an older
 * portal build, the pipeline retried, and the second pass short-circuited to
 * `step="complete"` because the resume index landed past the failed step.
 * That left a row with `step="complete"` AND a populated `error`/`failedAt` —
 * exactly the contradictory checkpoint PR #859 prevents going forward but
 * cannot retroactively clear.
 */
function hasContradictoryExecState(
  state: FeatureBuildRow["buildExecState"],
  verificationOut?: FeatureBuildRow["verificationOut"] | null,
): boolean {
  if (!state) return false;
  // Pipeline died before setting the first step (e.g. portal restart killed
  // the fire-and-forget autoExecuteBuild call during stepCreateSandbox).
  // The state object has content (sourceCurrency, ideateResearchRequested, etc.)
  // but no `step` key — so no standard recovery path applies:
  //   • retryBuildExecution requires step==="failed"
  //   • resumeBuildImplementation requires a releasable diff
  //   • advance-phase (review) is blocked without verificationOut
  // Reset Build is the only viable restart path.
  if (state.step == null) {
    return true;
  }
  // `failed` is a legitimate terminal step that retryBuildExecution handles;
  // every other step with an error/failedAt breadcrumb is contradictory.
  if (state.step !== "failed" && (state.error != null || state.failedAt != null)) {
    return true;
  }
  // Catch the "silent complete" case: the pipeline wrote step=complete but
  // verificationOut was never populated (tests never ran). This happens when
  // the portal restarts after stepComplete but before stepRunTests, or when
  // the diff-capture succeeded but stepRunTests was skipped. The build is
  // unreachable via resumeBuildImplementation (no releasable diff triggers
  // the gate) and unreachable via advance-phase (verificationOut null blocks
  // the review gate). Reset Build is the only recovery path.
  // Acceptance criterion: design doc FB-78E967D4 §AC-2.
  if (state.step === "complete" && verificationOut == null) {
    return true;
  }
  return false;
}

function hasCompletedUxVerification(build: FeatureBuildRow): boolean {
  const status = build.uxVerificationStatus;
  if (status !== "complete" && status !== "skipped") {
    return false;
  }

  if (!Array.isArray(build.uxTestResults)) {
    return true;
  }

  return build.uxTestResults.every((step) => step.passed);
}

export function deriveBuildStudioWorkflowAction({
  build,
  governedBacklogEnabled,
  progressVisibility,
}: ActionInput): BuildStudioWorkflowAction {
  const requiresApproval =
    isApprovalManagedBacklogBuild(build, governedBacklogEnabled)
    && build.draftApprovedAt == null
    && (build.phase === "ideate" || build.phase === "plan");

  if (requiresApproval) {
    return {
      kind: "approve-start",
      title: "Approval Required",
      message: describeApprovalGap(build),
      primaryLabel: "Record Approve Start",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Review with coworker",
      coworkerPrompt:
        "Review the draft assumptions with me and confirm what I should approve before this build moves forward.",
    };
  }

  if (build.phase === "ideate") {
    // BI-77A1973C: previously the ideate phase fell through to review-only,
    // hiding the advance affordance even after design review passed and the
    // intake gate auto-derived. The agent's chat said "Ready to advance to
    // Plan? Confirm and I'll structure the decomposition" but there was no
    // UI button to act on it — only chat-driven confirmation. Now there's an
    // explicit Advance to Plan button that mirrors the existing plan→build
    // pattern below. Disabled state surfaces the gate reason from
    // checkPhaseGate so users see exactly what's blocking (missing
    // designDoc, designReview pending, or intake anchors not satisfied).
    return {
      kind: "advance-phase",
      title: "Ready for Planning",
      message: "Move this reviewed design into planning so the coworker can decompose the work into sandbox tasks with acceptance criteria.",
      primaryLabel: "Advance to Plan",
      targetPhase: "plan",
      disabledReason: getPhaseGateReason(build, "plan"),
      coworkerLabel: "Refine the design",
      coworkerPrompt:
        "Use the saved Build Studio design evidence to confirm or revise the design now. If revisions are needed, save the updated design with saveBuildEvidence field designDoc and re-run reviewDesignDoc. Otherwise tell me Advance to Plan is the next approval.",
    };
  }

  if (build.phase === "plan") {
    const decompositionAffordance = derivePlanOscillationDecompositionAffordance({
      phase: build.phase,
      planReview: build.planReview,
      parentEpicId: build.parentEpicId ?? null,
      designDoc: build.designDoc,
    });

    if (decompositionAffordance.kind === "decompose-now") {
      return {
        kind: "decompose-now",
        title: "Plan Review Is Oscillating",
        message: "Plan review is oscillating instead of converging. Split this top-level build into smaller child builds before burning another review round.",
        primaryLabel: "Decompose now",
        targetPhase: null,
        disabledReason: decompositionAffordance.disabledReason,
        coworkerLabel: "Review scope with coworker",
        coworkerPrompt:
          "Explain why the Plan review is oscillating, summarize the D38 trajectory, and help me choose a smaller decomposition for this top-level build.",
      };
    }

    if (decompositionAffordance.kind === "amend-parent-design") {
      return {
        kind: "amend-parent-design",
        title: "Amend Parent Design",
        message: "This child build's Plan review is still oscillating. Recursive decomposition is disabled; amend the parent design so the sibling scopes can be re-derived together.",
        primaryLabel: "Amend parent design",
        targetPhase: null,
        disabledReason: decompositionAffordance.disabledReason,
        coworkerLabel: "Amend with coworker",
        coworkerPrompt:
          "This child build is oscillating in Plan review. Help me amend the parent design instead of recursively decomposing this child; preserve completed sibling work and call out what must wait for the Phase 8 amendment flow.",
      };
    }

    return {
      kind: "advance-phase",
      title: "Ready for Implementation",
      message: "Move this reviewed plan into sandbox execution so the coworker can start the keeper change and capture evidence in Build Studio.",
      primaryLabel: "Start Implementation",
      targetPhase: "build",
      disabledReason: getPhaseGateReason(build, "build"),
      coworkerLabel: "Refine the plan",
      coworkerPrompt:
        "Use the approved Build Studio design evidence to create or revise the implementation plan now. Save the plan with saveBuildEvidence field buildPlan, run reviewBuildPlan, and only tell me Start Implementation is next after those succeed.",
    };
  }

  if (build.phase === "build") {
    // Check contradictory exec state BEFORE recoverable-concern: if the
    // pipeline checkpoint is invalid (step=complete with no verification or
    // with an error breadcrumb), Resume Implementation will fail regardless
    // of task state. Reset Build is the only viable recovery path.
    if (hasContradictoryExecState(build.buildExecState, build.verificationOut)) {
      const isStalledAtPending =
        build.buildExecState != null && build.buildExecState.step == null;
      const isSilentComplete =
        build.buildExecState?.step === "complete" &&
        (build.buildExecState?.error == null && build.buildExecState?.failedAt == null) &&
        build.verificationOut == null;
      return {
        kind: "reset-build",
        title: "Build Pipeline Needs Reset",
        message: isStalledAtPending
          ? "The build pipeline stalled before it could start — the process was likely interrupted (e.g. portal restart) before the first step completed. Reset will restart the pipeline from scratch."
          : isSilentComplete
            ? "The pipeline reported completion but verification results are missing — the sandbox likely ran but tests were never captured. Reset will restart the full build from the beginning."
            : "The build pipeline checkpoint is in a contradictory shape (a prior run left an error breadcrumb on a non-failed step). Clear the checkpoint and re-run the pipeline from the start.",
        primaryLabel: "Reset Build",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Diagnose with coworker",
        coworkerPrompt: isStalledAtPending
          ? "The build pipeline has no recorded step — it was likely interrupted before the first step completed. Confirm whether a Reset Build is safe to restart the pipeline from scratch."
          : isSilentComplete
            ? "The build shows step=complete but verificationOut is null, meaning tests never ran or the result was not captured. Explain what likely happened and confirm whether a full Reset Build is the right recovery."
            : "The build's execution checkpoint is contradictory (step says complete but an error breadcrumb is set). Read buildExecState and tell me whether a Reset Build is safe or if the original error needs investigation first.",
      };
    }

    // Only evaluate recoverable-concern state after the contradictory-state
    // check — Resume Implementation requires a healthy sandbox checkpoint.
    const concernState = getImplementationConcernState(build, progressVisibility);
    if (concernState.hasRecoverableConcern) {
      return buildResumeAction({
        state: concernState,
        coworkerLabel: "Review failures with coworker",
        coworkerPrompt:
          "The current build still has flagged execution or verification concerns. Explain what failed, then rerun the non-clean implementation work on a healthy sandbox and tell me when verification is genuinely ready.",
      });
    }

    // Sandbox launch failed before writing any task results — exec state is
    // "failed" but there is nothing to resume; only a clean retry will work.
    const execFailed = build.buildExecState?.step === "failed";
    const hasNoResults = concernState.taskResults.tasks.length === 0;
    if (execFailed && hasNoResults) {
      return {
        kind: "retry-build",
        title: "Sandbox Launch Failed",
        message:
          "The sandbox container could not be started before any implementation work began. Retry to attempt a fresh sandbox launch.",
        primaryLabel: "Retry Sandbox Launch",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Diagnose with coworker",
        coworkerPrompt:
          "The sandbox failed to start before any tasks ran. Check the last build execution error and tell me whether a plain retry is safe or whether the build plan or sandbox config needs to change first.",
      };
    }

    return {
      kind: "advance-phase",
      title: "Ready for Verification",
      message: "Use Build Studio to move implementation into review so verification, UX checks, and sandbox evidence are gathered on the main operating surface.",
      primaryLabel: "Run Verification Review",
      targetPhase: "review",
      disabledReason: getPhaseGateReason(build, "review"),
      coworkerLabel: "Ask coworker to finish implementation",
      coworkerPrompt:
        "Finish any remaining implementation work, summarize what changed, and confirm when verification is ready to run.",
    };
  }

  if (build.phase === "review") {
    const concernState = getImplementationConcernState(build, progressVisibility);
    if (concernState.hasRecoverableConcern) {
      return buildResumeAction({
        state: concernState,
        coworkerLabel: "Recover with coworker",
        coworkerPrompt:
          "The current review state reflects implementation failures, not a clean verification pass. Recover the build from the live product path: rerun the non-clean implementation work on a healthy sandbox, then tell me the next approval when verification is truly ready.",
      });
    }
  }

  if (build.phase === "review") {
    const acceptanceCriteria = Array.isArray(build.brief?.acceptanceCriteria)
      ? build.brief.acceptanceCriteria
      : [];
    const needsUxVerification = acceptanceCriteria.length > 0
      && (build.uxVerificationStatus == null || build.uxVerificationStatus === "failed");
    if (needsUxVerification) {
      const rerun = build.uxVerificationStatus === "failed";
      return {
        kind: "run-review-verification",
        title: rerun ? "Retry UX Verification" : "Run UX Verification",
        message: "Review still needs live sandbox UX evidence. Run the Build Studio verification pass here, then use the coworker to finish acceptance evidence before continuing to release.",
        primaryLabel: rerun ? "Retry UX Verification" : "Run UX Verification",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Finish acceptance review",
        coworkerPrompt:
          "UX verification is being handled from the Build Studio controls. Evaluate each acceptance criterion with saveBuildEvidence field acceptanceMet, summarize any gaps, and tell me when Continue to Release should unlock.",
      };
    }

    const disabledReason = getPhaseGateReason(build, "ship");
    const needsAcceptanceRecording =
      disabledReason === "Acceptance criteria not evaluated."
      && build.verificationOut?.typecheckPassed === true
      && hasCompletedUxVerification(build);

    if (needsAcceptanceRecording) {
      return {
        kind: "record-acceptance",
        title: "Record Review Acceptance",
        message: "The review evidence is in place. Record the human acceptance decision here so Build Studio can continue into release decisions without waiting on the coworker route.",
        primaryLabel: "Record Acceptance",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Summarize review with coworker",
        coworkerPrompt:
          "Typecheck is clean and UX verification is complete. Summarize the review evidence in plain language and tell me whether Continue to Release should now unlock after I record the acceptance decision.",
      };
    }

    const blockedByEvidence = disabledReason != null;

    return {
      kind: "advance-phase",
      title: blockedByEvidence ? "Complete Review Evidence" : "Ready for Release Decisions",
      message: blockedByEvidence
        ? "Review is still missing evidence or approvals. Use the coworker to finish acceptance checks, UX verification, and release-readiness evidence from the Build Studio surface."
        : "Review evidence is in place. Continue into release decisions so you can assess community sharing, timing, and production promotion from the main studio.",
      primaryLabel: "Continue to Release",
      targetPhase: "ship",
      disabledReason,
      coworkerLabel: blockedByEvidence ? "Finish review with coworker" : "Review release summary",
      coworkerPrompt: blockedByEvidence
        ? "Review is blocked by missing evidence or failed checks. Evaluate each acceptance criterion with saveBuildEvidence field acceptanceMet, make sure UX verification is complete, and tell me when Continue to Release should unlock."
        : "Summarize the completed review evidence, remaining release risks, and what I should confirm before continuing to release decisions.",
    };
  }

  if (build.phase === "failed") {
    return {
      kind: "retry-build",
      title: "Build Needs Attention",
      message: "The last sandbox execution failed. Retry from Build Studio once you understand the blocker or ask the coworker to explain the failure.",
      primaryLabel: "Retry Build",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Diagnose with coworker",
      coworkerPrompt:
        "Explain why this build failed, what evidence you have, and what I should do next before retrying.",
    };
  }

  return {
    kind: "review-only",
    title: "Review the Current Stage",
    message: "Inspect the current workflow evidence, talk with the coworker if something looks off, and use the phase controls when the next gate is ready.",
    primaryLabel: null,
    targetPhase: null,
    disabledReason: null,
    coworkerLabel: "Open coworker",
    coworkerPrompt:
      "Summarize the current Build Studio state, the next recommended action, and any risks I should review before proceeding.",
  };
}

export function deriveWorkflowStageGuidance({
  build,
  phase,
  workflowLabel,
  governedBacklogEnabled,
  progressVisibility,
}: StageGuidanceInput): WorkflowStageGuidance {
  const workflowAction = deriveBuildStudioWorkflowAction({
    build,
    governedBacklogEnabled,
    progressVisibility,
  });

  if (
    phase === "ideate"
    && workflowAction.kind === "approve-start"
  ) {
    return {
      title: "Approval Required",
      nextApproval:
        workflowLabel === "Prepared Draft" || workflowLabel === "Ready to Start"
          ? "Approve Start to let Build Studio move from draft preparation into planning and implementation."
          : "Approve Start should be recorded here before the backlog-linked build continues beyond ideation.",
      workflowAction,
    };
  }

  if (phase === "plan" && workflowAction.kind === "advance-phase" && workflowAction.targetPhase === "build") {
    return {
      title: "Ready for Implementation",
      nextApproval:
        workflowAction.disabledReason == null
          ? "Start implementation from the studio when you are ready for the coworker to execute in the sandbox."
          : workflowAction.disabledReason,
      workflowAction,
    };
  }

  if (phase === "build" && workflowAction.kind === "advance-phase" && workflowAction.targetPhase === "review") {
    return {
      title: "Verification Gate",
      nextApproval:
        workflowAction.disabledReason == null
          ? "Run verification review to collect build checks, UX evidence, and the release-readiness summary."
          : workflowAction.disabledReason,
      workflowAction,
    };
  }

  if (workflowAction.kind === "resume-implementation") {
    return {
      title: workflowAction.title,
      nextApproval:
        "Resume implementation from Build Studio so the coworker can rerun the flagged work and return to review with clean evidence.",
      workflowAction,
    };
  }

  if (phase === "review" && workflowAction.kind === "advance-phase" && workflowAction.targetPhase === "ship") {
    return {
      title: workflowAction.title,
      nextApproval:
        workflowAction.disabledReason == null
          ? "Continue to release decisions when you are satisfied with the review evidence and sandbox behavior."
          : workflowAction.disabledReason,
      workflowAction,
    };
  }

  return {
    title: workflowAction.title,
    nextApproval:
      phase === "review"
        ? "Review the sandbox evidence and decide whether the feature is ready to move into release readiness."
        : phase === "ship"
          ? "Decide separately on community sharing, release timing, and production promotion."
          : workflowAction.message,
    workflowAction,
  };
}
