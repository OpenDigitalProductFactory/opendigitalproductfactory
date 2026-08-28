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
import { sizeGateDecompositionAction } from "@/lib/build/size-gate-decomposition-affordance";
import {
  isContradictoryExecState,
  type ExecStateLike,
} from "@/lib/build/build-exec-types";
import type { BuildProgressVisibility } from "@/lib/build/progress-visibility";
import type {
  BuildFailureAxis,
  ResumeImplementationModeDetail,
  TruthNumericSnapshot,
} from "@/lib/build/progress-visibility-types";
import {
  friendlyInferenceFailureMessage,
  isTransientInferenceFailure,
  type InferenceFailureKind,
} from "@/lib/build/inference-failure";

type BuildStudioWorkflowActionMetadata = {
  failureAxis?: BuildFailureAxis | null;
  truthSources?: TruthNumericSnapshot[];
  resumeMode?: ResumeImplementationModeDetail;
  /** BI-F0005EB0 — set on the retry-inference action so the custodian can render
   *  provider-detail-free copy for the specific failure. */
  inferenceFailureKind?: InferenceFailureKind | null;
};

export type BuildOperatorStatusKind =
  | "waiting-on-you"
  | "waiting-capacity"
  | "working"
  | "blocked-technical"
  | "escalated"
  | "complete";

export type BuildOperatorStatus = {
  kind: BuildOperatorStatusKind;
  label: "Waiting on you" | "Capacity wait" | "Working" | "Blocked (technical)" | "Escalated to you" | "Complete";
  intent: "accent" | "info" | "danger" | "success";
};

export type BuildStudioOperatorGuidance = {
  status: BuildOperatorStatus;
  nextLabel: string | null;
  nextSentence: string;
  useCoworkerForNext: boolean;
  guidedRecovery: boolean;
  recoveryHint: string | null;
};

type OperatorGuidanceBuildContext = Pick<FeatureBuildRow, "phase" | "buildExecState">;

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
    // BI-F0005EB0 (EP-BS-UX-HARDENING) — the AI call itself failed (e.g. the
    // ideate/scout inference errored with a connection/provider failure). Scoped
    // to the coworker-chat deliberation phases (ideate/plan); surfaces a danger
    // "Retry the AI call" affordance instead of the benign "Waiting on evidence"
    // state, and re-drives the failed turn rather than asking the human to
    // diagnose logs.
    kind: "retry-inference";
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
    // BI-E1CB0522 — first-class "Re-run Plan Review" recovery affordance.
    // Surfaces in the plan phase when planReview.decision === "fail" so an
    // operator can refresh a stale/failed review (using the CURRENT reviewer
    // logic) without dropping to MCP/raw DB. A re-run that now passes (e.g. a
    // chore whose only criticals are now-lenient test-first items) auto-
    // advances plan->build through the canonical executeTool path.
    kind: "rerun-plan-review";
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
  } & BuildStudioWorkflowActionMetadata)
  | ({
    // BI-A2F3FA9D — a build escalated to a human (phase="abandoned"). Terminal:
    // WIP is already freed and the originating BI parked as "deferred", so there
    // is no in-place server action — primaryLabel is null and the operator's
    // resume path is the parked backlog item (resumeHref). Rendered at danger
    // intent so the handoff is unmistakable instead of the old stale "Working".
    kind: "escalated-to-human";
    title: string;
    message: string;
    // Structurally uniform with the sibling variants (string | null) rather than
    // literal `null`, so union-spread-and-override patterns still typecheck; it is
    // always constructed as null (terminal — no in-place server action).
    primaryLabel: string | null;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
    /** Originating BacklogItem.itemId (BI-XXXX) parked as deferred, if any. */
    parkedBacklogItemId: string | null;
    /** Human-readable escalation reason (FeatureBuild.abandonReason). */
    abandonReason: string | null;
    /** Where the operator resumes the work — the Delivery/Backlog surface. */
    resumeHref: string;
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
    kind: build.kind ?? "feature",
    fixContext: build.brief?.fixContext,
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

/**
 * BI-E1CB0522 — true when a plan review has been run and FAILED. Defensive
 * against the loosely-typed JSON column: only a persisted review object whose
 * decision is exactly "fail" counts (a null/absent review is "not yet run",
 * not "failed", and must not surface the re-run affordance).
 */
function isPlanReviewFailed(planReview: FeatureBuildRow["planReview"]): boolean {
  if (!planReview || typeof planReview !== "object") return false;
  return (planReview as { decision?: unknown }).decision === "fail";
}

function describeApprovalGap(build: FeatureBuildRow): string {
  if (build.phase === "ideate") {
    return "This linked backlog build still needs a recorded owner start approval before Build Studio should move into planning.";
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

  // Mirror checkPhaseGate's verification policy in the ACTION layer: typecheck is
  // the only hard verification gate; test failures are ADVISORY unless they land
  // in the build's own changed surface. A build whose SCOPED surface is clean
  // (typecheck passed + no in-scope affected-test failures) must not be forced
  // back to "Resume Implementation" by out-of-scope / whole-repo suite noise —
  // the same global-failure noise the scoped gate already neutralizes
  // (BI-4890FDC3). Without a scoped projection we cannot prove cleanliness, so we
  // preserve the legacy (stricter) behavior.
  const scoped = progressVisibility?.verification?.buildScoped ?? null;
  const scopedSurfaceClean =
    scoped != null
    && scoped.typecheckPassed !== false
    && (scoped.affectedTests?.length ?? 0) === 0;

  const verificationFailed =
    verification.typecheckPassed === false
    || (explicitFailureAxis != null && !scopedSurfaceClean);

  // When the scoped surface is clean, a task that merely COMPLETED WITH CONCERNS
  // (e.g. a verification task that ran the whole-repo suite and reported
  // out-of-scope failures) is advisory, not a blocker. Genuinely blocked or
  // incomplete tasks still count as a recoverable concern.
  const blockingNonCleanTasks = scopedSurfaceClean
    ? nonCleanTasks.filter((task) => task.outcome !== "DONE_WITH_CONCERNS")
    : nonCleanTasks;

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
    hasRecoverableConcern: blockingNonCleanTasks.length > 0 || verificationFailed,
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

function statusForAction(
  action: BuildStudioWorkflowAction,
  build?: OperatorGuidanceBuildContext,
): BuildOperatorStatus {
  // The workflow action falls back to review-only after the terminal phase,
  // but terminal truth outranks that generic action classification. Without
  // this guard a completed build rendered a green banner labelled "Working".
  if (build?.phase === "complete") {
    return {
      kind: "complete",
      label: "Complete",
      intent: "success",
    };
  }

  // BI-A2F3FA9D — terminal handoff: the build is a human's now, not "Working".
  if (action.kind === "escalated-to-human") {
    return {
      kind: "escalated",
      label: "Escalated to you",
      intent: "danger",
    };
  }

  if (
    action.kind === "retry-build"
    || action.kind === "reset-build"
    || action.kind === "resume-implementation"
  ) {
    return {
      kind: "blocked-technical",
      label: "Blocked (technical)",
      intent: "danger",
    };
  }

  if (action.kind === "retry-inference") {
    return isTransientInferenceFailure(action.inferenceFailureKind ?? null)
      ? { kind: "waiting-capacity", label: "Capacity wait", intent: "info" }
      : { kind: "blocked-technical", label: "Blocked (technical)", intent: "danger" };
  }

  const exec = build?.buildExecState as { step?: string | null; error?: string | null } | null | undefined;
  if (
    build?.phase === "build"
    && exec?.step
    && exec.step !== "failed"
    && exec.step !== "complete"
    && !exec.error
  ) {
    return {
      kind: "working",
      label: "Working",
      intent: "info",
    };
  }

  if (action.kind === "review-only") {
    return {
      kind: "working",
      label: "Working",
      intent: "info",
    };
  }

  return {
    kind: "waiting-on-you",
    label: "Waiting on you",
    intent: "accent",
  };
}

function nextSentenceForAction(action: BuildStudioWorkflowAction): string {
  if (action.disabledReason) {
    return "Next: ask the AI Coworker to collect the missing evidence.";
  }

  switch (action.kind) {
    case "approve-start":
      return "Next: approve the start. I will keep planning from there.";
    case "advance-phase":
      if (action.targetPhase === "plan") return "Next: move this design into planning.";
      if (action.targetPhase === "build") return "Next: start implementation. I will track the checks.";
      if (action.targetPhase === "review") return "Next: run verification review. I will collect the evidence.";
      if (action.targetPhase === "ship") return "Next: continue to release decisions.";
      return "Next: move this build to the next stage.";
    case "run-review-verification":
      return "Next: run UX verification. I will use the result to keep this build moving.";
    case "record-acceptance":
      return "Next: record acceptance so release decisions can unlock.";
    case "retry-build":
      return "Next: retry the sandbox launch.";
    case "retry-inference":
      return isTransientInferenceFailure(action.inferenceFailureKind ?? null)
        ? "Next: retry when convenient. Your change will stay here while capacity recovers."
        : "Next: retry the AI call after the issue is resolved.";
    case "reset-build":
      return "Next: reset the build pipeline and start it again.";
    case "resume-implementation":
      return "Next: try to fix the failed work. I will rerun the recovery path.";
    case "decompose-now":
      return "Next: split this build into smaller builds.";
    case "amend-parent-design":
      return "Next: amend the parent design before this child continues.";
    case "rerun-plan-review":
      return "Next: try to fix the plan review here.";
    case "review-only":
      return "Next: I am watching this stage. Ask if anything looks stuck.";
    case "escalated-to-human":
      return action.parkedBacklogItemId
        ? `Next: pick up ${action.parkedBacklogItemId} in Delivery when you are ready.`
        : "Next: pick up the parked item in Delivery when you are ready.";
  }
}

export function deriveBuildStudioOperatorGuidance(
  action: BuildStudioWorkflowAction,
  build?: OperatorGuidanceBuildContext,
): BuildStudioOperatorGuidance {
  const terminalComplete = build?.phase === "complete";
  const useCoworkerForNext = !terminalComplete
    && (action.disabledReason != null || action.primaryLabel == null);
  const guidedRecovery = action.kind === "rerun-plan-review" || action.kind === "resume-implementation";
  return {
    status: statusForAction(action, build),
    nextLabel: terminalComplete
      ? null
      : useCoworkerForNext ? action.coworkerLabel : action.primaryLabel,
    nextSentence: terminalComplete
      ? "The result and its evidence are ready to review."
      : nextSentenceForAction(action),
    useCoworkerForNext,
    guidedRecovery,
    recoveryHint: guidedRecovery
      ? "Choose Try to fix when the failure looks stale or already addressed. Choose Something looks off when the plan or checks need a human-readable revision first."
      : null,
  };
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
    axis === "out-of-scope-noise"
      ? "Review workspace noise before retrying this build"
      : blockedCount > 0
        ? blockedCount === 1
          ? "1 task needs another pass"
          : `${blockedCount} tasks need another pass`
        : state.resumeMode.mode === "replan-and-dispatch"
          ? "Implementation needs a fresh plan"
          : "Verification needs another pass";
  // BI-FD796419 / Band 4 — lead with plain "what it means + what to do";
  // technical recovery metadata stays on structured fields for engineer view.
  const message =
    axis === "out-of-scope-noise"
      ? "The failed checks look like they came from other work, not this build. Next: click Try to fix to rerun recovery from Build Studio."
      : "Some work did not pass its checks yet. Next: click Try to fix to rerun the failed work from Build Studio.";

  return {
    kind: "resume-implementation",
    title,
    message,
    primaryLabel: "Try to fix",
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
 * BI-F0005EB0 — build the "Retry the AI call" action for a failed ideate/plan
 * inference. Copy is provider-detail-free (via friendlyInferenceFailureMessage);
 * the raw error stays in server logs. `phase` labels the coworker recovery
 * prompt so the re-drive re-asks the right deliberation question.
 */
function buildRetryInferenceAction(
  phase: "ideate" | "plan",
  kind: InferenceFailureKind | null,
): BuildStudioWorkflowAction {
  const friendly = kind
    ? friendlyInferenceFailureMessage(kind)
    : "The AI call did not complete. Retry to try the request again.";
  const phaseNoun = phase === "ideate" ? "define this feature" : "plan this build";
  const title = isTransientInferenceFailure(kind)
    ? "Waiting for AI capacity"
    : kind === "config"
      ? "AI setup needs attention"
      : "No usable AI response";
  return {
    kind: "retry-inference",
    title,
    message: `${friendly} Next: click Retry the AI call to run it again.`,
    primaryLabel: "Retry the AI call",
    targetPhase: null,
    disabledReason: null,
    coworkerLabel: "Ask the AI Coworker to retry",
    coworkerPrompt: `The last AI response failed to complete (the request errored, not a missing input from me). Please retry the request now and continue helping me ${phaseNoun}.`,
    inferenceFailureKind: kind,
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
  // Delegates to the shared classifier in build-exec-types so the UI affordance
  // and the boot auto-recovery (instrumentation.ts) agree on what "stuck" means.
  // The three contradictory shapes:
  //   • missing-step       — restart killed the pipeline before step 1
  //   • error-without-fail — non-`failed` step with an error/failedAt breadcrumb
  //   • complete-no-verify — step=complete but verificationOut never populated
  return isContradictoryExecState(
    state as ExecStateLike | null,
    verificationOut ?? undefined,
  );
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
  // BI-A2F3FA9D — terminal escalate-to-human handoff. Must be FIRST: an abandoned
  // build has been handed to a human (WIP freed, BI parked as "deferred"), so
  // none of the phase-progression branches apply. Before this branch existed the
  // abandoned phase fell through to "review-only", which renders a stale
  // "Working — watching this stage". Now the operator sees the handoff, the
  // parked backlog item, the reason, and a resume path at danger intent.
  if (build.phase === "abandoned") {
    const parkedBacklogItemId = build.originator?.itemId ?? null;
    const abandonReason = build.abandonReason?.trim() || null;
    const parkedClause = parkedBacklogItemId
      ? `It is parked as ${parkedBacklogItemId}, waiting for you.`
      : "It is waiting for you in Delivery.";
    return {
      kind: "escalated-to-human",
      title: "Escalated to you",
      message:
        `Build Studio could not finish this build on its own and handed it to you. ` +
        parkedClause +
        (abandonReason ? ` Reason: ${abandonReason}` : ""),
      primaryLabel: null,
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Ask coworker to summarize",
      coworkerPrompt:
        "This build was escalated to the owner and abandoned. Summarize in plain language why it could not be completed automatically, what the parked backlog item now needs, and the safest next step for me to take.",
      parkedBacklogItemId,
      abandonReason,
      resumeHref: "/ops",
    };
  }

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

  // BI-F0005EB0 — a failed AI call (inference errored) in a coworker-chat
  // deliberation phase must surface as a distinct danger "Retry the AI call"
  // affordance, NOT the benign "Waiting on evidence". Scoped to ideate/plan so it
  // never shadows the richer exec-state recovery paths in build/review, and taken
  // ONLY while the next gate is unmet — a satisfied gate means the failed call
  // already did its work, so retry must not be the owner's only move.
  if (
    (build.phase === "ideate" || build.phase === "plan")
    && progressVisibility?.inferenceFailure?.failed === true
    && getPhaseGateReason(build, build.phase === "ideate" ? "plan" : "build") !== null
  ) {
    return buildRetryInferenceAction(build.phase, progressVisibility.inferenceFailure.kind ?? null);
  }

  if (build.phase === "ideate") {
    // BI-04B112CA: a size-gated design gets the split, not a blocked advance.
    const split = sizeGateDecompositionAction(build);
    if (split) return { kind: "decompose-now", targetPhase: null, ...split };

    // BI-77A1973C: ideate once fell through to review-only, hiding the advance
    // even after design review passed. The disabled state surfaces the gate
    // reason from checkPhaseGate so the owner sees what is blocking.
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

    // BI-E1CB0522 — a FAILED (non-oscillating) plan review is otherwise a dead
    // end in the UI: "Start Implementation" is gated and the only escape is the
    // coworker chat. Surface a first-class "Re-run Plan Review" action that
    // re-runs the CANONICAL reviewer (executeTool path, with the #1976/#1998
    // kind-aware test-first lenience + plan->build auto-advance). This refreshes
    // a stale failed review after a reviewer-logic fix deploys — e.g. a chore
    // whose only criticals are now-lenient test-first items will pass and
    // advance. Oscillating reviews are handled by the decompose/amend branches
    // above (another review round won't converge), so this only fires when the
    // plan review failed but is NOT oscillating.
    if (isPlanReviewFailed(build.planReview)) {
      return {
        kind: "rerun-plan-review",
        title: "Plan review needs a fix",
        message:
          "The plan review did not pass. Next: click Try to fix to rerun the guided recovery in Build Studio, or choose Something looks off if the plan needs edits first.",
        primaryLabel: "Try to fix",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Something looks off",
        coworkerPrompt:
          "The Build Studio plan review failed. Explain the blocking issues in plain language, update the saved implementation plan to address them, run the plan review again, and report whether implementation is unlocked.",
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
      // Don't fabricate a cause. A null-step checkpoint can come from a failed
      // dispatch, an early crash, an OOM / codegen context-overflow, a watchdog
      // reap, OR a process restart. If the pipeline left an actual error
      // breadcrumb, surface THAT verbatim instead of guessing "portal restart"
      // — the old copy sent operators chasing restarts that never happened.
      const stalledReason =
        typeof build.buildExecState?.error === "string" && build.buildExecState.error.trim()
          ? build.buildExecState.error.trim()
          : null;
      const stalledReasonShort = stalledReason
        ? stalledReason.slice(0, 240) + (stalledReason.length > 240 ? "…" : "")
        : null;
      return {
        kind: "reset-build",
        title: "Build Pipeline Needs Reset",
        message: isStalledAtPending
          ? (stalledReasonShort
              ? `The build pipeline stalled without a resumable step. Recorded reason: ${stalledReasonShort} — Reset will restart the pipeline from scratch.`
              : "The build pipeline stalled with no recorded step and no error breadcrumb — it was interrupted before the first step completed (e.g. a failed dispatch, an early crash, or a process restart). Reset will restart the pipeline from scratch.")
          : isSilentComplete
            ? "The pipeline reported completion but verification results are missing — the sandbox likely ran but tests were never captured. Reset will restart the full build from the beginning."
            : "The build pipeline checkpoint is in a contradictory shape (a prior run left an error breadcrumb on a non-failed step). Clear the checkpoint and re-run the pipeline from the start.",
        primaryLabel: "Reset Build",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Diagnose with coworker",
        coworkerPrompt: isStalledAtPending
          ? (stalledReasonShort
              ? `The build pipeline stalled without a resumable step. The recorded reason was: ${stalledReasonShort}. Confirm whether a Reset Build is safe, or whether that root cause needs investigating first.`
              : "The build pipeline has no recorded step and no error breadcrumb — it was interrupted before the first step (a failed dispatch, an early crash, or a process restart). Confirm whether a Reset Build is safe to restart the pipeline from scratch.")
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
          "The current build still has execution or verification concerns. Explain what failed in plain language, rerun the non-clean implementation work through the existing recovery path, and report when verification is genuinely ready.",
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
          "The current review state reflects implementation failures, not a clean verification pass. Recover the build through the existing Build Studio recovery path, then tell me the next approval when verification is truly ready.",
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
        message: "The review evidence is in place. Record the owner acceptance decision here so Build Studio can continue into release decisions without waiting on the coworker route.",
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
        "Try to fix from Build Studio so the coworker can rerun the flagged work and return to review with clean evidence.",
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
