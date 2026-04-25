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
        "Review this implementation plan with me, call out any missing details, and tell me when it is ready to start implementation.",
    };
  }

  if (build.phase === "build") {
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
