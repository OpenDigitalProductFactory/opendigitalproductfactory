import {
  checkPhaseGate,
  normalizeHappyPathState,
  type BuildPhase,
  type FeatureBuildRow,
} from "@/lib/feature-build-types";

export type BuildStudioWorkflowAction =
  | {
    kind: "approve-start";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "advance-phase";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: BuildPhase;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "run-review-verification";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "record-acceptance";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "retry-build";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "resume-implementation";
    title: string;
    message: string;
    primaryLabel: string;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  }
  | {
    kind: "review-only";
    title: string;
    message: string;
    primaryLabel: string | null;
    targetPhase: null;
    disabledReason: string | null;
    coworkerLabel: string;
    coworkerPrompt: string;
  };

export type WorkflowStageGuidance = {
  title: string;
  nextApproval: string;
  workflowAction: BuildStudioWorkflowAction;
};

type ActionInput = {
  build: FeatureBuildRow;
  governedBacklogEnabled: boolean;
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

function hasRecoverableImplementationConcerns(build: FeatureBuildRow): boolean {
  const taskResults = build.taskResults as
    | {
      tasks?: Array<{ outcome?: string | null }>;
    }
    | null;
  const hasTaskConcern = taskResults?.tasks?.some((task) => task.outcome !== "DONE") ?? false;

  const verification = build.verificationOut as
    | {
      typecheckPassed?: boolean;
    }
    | null;
  const hasVerificationFailure = verification?.typecheckPassed === false;

  return hasTaskConcern || hasVerificationFailure;
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

  if (build.phase === "plan") {
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
    if (hasRecoverableImplementationConcerns(build)) {
      return {
        kind: "resume-implementation",
        title: "Implementation Needs Recovery",
        message: "This build recorded execution or verification concerns. Reopen implementation so the coworker can rerun the non-clean tasks on a healthy sandbox before review continues.",
        primaryLabel: "Resume Implementation",
        targetPhase: null,
        disabledReason: null,
        coworkerLabel: "Review failures with coworker",
        coworkerPrompt:
          "The current build still has flagged execution or verification concerns. Explain what failed, then rerun the non-clean implementation work on a healthy sandbox and tell me when verification is genuinely ready.",
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

  if (build.phase === "review" && hasRecoverableImplementationConcerns(build)) {
    return {
      kind: "resume-implementation",
      title: "Implementation Needs Recovery",
      message: "Review surfaced implementation-side failures rather than a clean verification pass. Resume implementation from Build Studio, rerun the non-clean tasks, and come back to review with real sandbox evidence.",
      primaryLabel: "Resume Implementation",
      targetPhase: null,
      disabledReason: null,
      coworkerLabel: "Recover with coworker",
      coworkerPrompt:
        "The current review state reflects implementation failures, not a clean verification pass. Recover the build from the live product path: rerun the non-clean implementation work on a healthy sandbox, then tell me the next approval when verification is truly ready.",
    };
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
}: StageGuidanceInput): WorkflowStageGuidance {
  const workflowAction = deriveBuildStudioWorkflowAction({
    build,
    governedBacklogEnabled,
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
