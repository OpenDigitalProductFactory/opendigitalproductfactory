import type {
  ActivityClass,
  ActivityContract,
  ActivityDistributionShape,
  ActivityEvaluationPolicy,
  ActivityParentRef,
  ActivityRiskClass,
  ActivityRouteContext,
  ActivityRouteContextHints,
  ActivitySuccessShape,
  ActivityTokenEnvelope,
} from "./activity-contract";

export type BuildStudioActivityPhase =
  | "ideate"
  | "plan"
  | "design-review"
  | "plan-review"
  | "build"
  | "verify";

export type CompileBuildStudioPhaseActivityInput = {
  phase: BuildStudioActivityPhase;
  parentRef: ActivityParentRef;
};

export type CompileCompoundRequestActivitiesInput = {
  requestId: string;
  parentRef: ActivityParentRef;
  prompt: string;
  requiresCodeChange?: boolean;
  requiresUiChange?: boolean;
  requiresToolUse?: boolean;
  requiresExternalResearch?: boolean;
};

type ActivityDefaults = {
  title: string;
  activityClass: ActivityClass;
  distributionShape: ActivityDistributionShape;
  riskClass: ActivityRiskClass;
  successShape: ActivitySuccessShape;
  contextPolicy: ActivityContract["contextPolicy"];
  tokenEnvelope: ActivityTokenEnvelope;
  evaluationPolicy: ActivityEvaluationPolicy;
  requestContractHints: ActivityRouteContextHints;
};

type CompoundActivityClass = Extract<
  ActivityClass,
  "summarize" | "critique" | "plan" | "code-edit" | "tool-act" | "verify" | "handoff"
>;

const STANDARD_TOKENS: ActivityTokenEnvelope = {
  maxInputTokens: 32_000,
  maxOutputTokens: 4_000,
  compression: "summarize",
};

const REVIEW_TOKENS: ActivityTokenEnvelope = {
  maxInputTokens: 48_000,
  maxOutputTokens: 2_000,
  compression: "cite-sources",
};

const COMPOUND_ACTIVITY_DEFAULTS: Record<CompoundActivityClass, ActivityDefaults> = {
  summarize: {
    title: "Distill source material",
    activityClass: "summarize",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: {
      maxInputTokens: 64_000,
      maxOutputTokens: 2_000,
      compression: "summarize",
    },
    evaluationPolicy: { evaluator: "human-acceptance", minimumSignal: "accepted" },
    requestContractHints: {
      taskType: "summarization",
      budgetClass: "minimize_cost",
      reasoningDepth: "low",
      minimumTier: "adequate",
    },
  },
  critique: {
    title: "Assess architecture fit",
    activityClass: "critique",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "decision",
    contextPolicy: "work-case-packet",
    tokenEnvelope: REVIEW_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  plan: {
    title: "Plan activity routing changes",
    activityClass: "plan",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "decision",
    contextPolicy: "work-case-packet",
    tokenEnvelope: REVIEW_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
    requestContractHints: {
      taskType: "reasoning",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  "code-edit": {
    title: "Apply implementation changes",
    activityClass: "code-edit",
    distributionShape: "mixed",
    riskClass: "high",
    successShape: "patch",
    contextPolicy: "work-case-packet",
    tokenEnvelope: {
      maxInputTokens: 64_000,
      maxOutputTokens: 8_000,
      compression: "strict-packet",
    },
    evaluationPolicy: { evaluator: "tool-success", minimumSignal: "no-regression" },
    requestContractHints: {
      taskType: "code-gen",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
      requiresCodeExecution: true,
    },
  },
  "tool-act": {
    title: "Execute tool-backed activity",
    activityClass: "tool-act",
    distributionShape: "mixed",
    riskClass: "medium",
    successShape: "tool-result",
    contextPolicy: "retrieval",
    tokenEnvelope: STANDARD_TOKENS,
    evaluationPolicy: { evaluator: "tool-success", minimumSignal: "valid-output" },
    requestContractHints: {
      taskType: "tool-action",
      budgetClass: "balanced",
      reasoningDepth: "medium",
      minimumTier: "strong",
    },
  },
  verify: {
    title: "Verify activity outcomes",
    activityClass: "verify",
    distributionShape: "mixed",
    riskClass: "high",
    successShape: "evidence",
    contextPolicy: "work-case-packet",
    tokenEnvelope: STANDARD_TOKENS,
    evaluationPolicy: { evaluator: "tool-success", minimumSignal: "no-regression" },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
      requiresCodeExecution: true,
    },
  },
  handoff: {
    title: "Prepare operator handoff",
    activityClass: "handoff",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "minimal",
    tokenEnvelope: {
      maxInputTokens: 16_000,
      maxOutputTokens: 1_500,
      compression: "summarize",
    },
    evaluationPolicy: { evaluator: "human-acceptance", minimumSignal: "accepted" },
    requestContractHints: {
      taskType: "summarization",
      budgetClass: "minimize_cost",
      reasoningDepth: "low",
      minimumTier: "adequate",
    },
  },
};

const BUILD_STUDIO_PHASES: Record<BuildStudioActivityPhase, ActivityDefaults> = {
  ideate: {
    title: "Generate solution direction",
    activityClass: "synthesize",
    distributionShape: "mixed",
    riskClass: "medium",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: STANDARD_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "accepted" },
    requestContractHints: {
      taskType: "reasoning",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  plan: {
    title: "Produce implementation plan",
    activityClass: "plan",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "decision",
    contextPolicy: "work-case-packet",
    tokenEnvelope: REVIEW_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
    requestContractHints: {
      taskType: "reasoning",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  "design-review": {
    title: "Review design",
    activityClass: "critique",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "decision",
    contextPolicy: "work-case-packet",
    tokenEnvelope: REVIEW_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  "plan-review": {
    title: "Review implementation plan",
    activityClass: "critique",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "decision",
    contextPolicy: "work-case-packet",
    tokenEnvelope: REVIEW_TOKENS,
    evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    },
  },
  build: {
    title: "Apply code change",
    activityClass: "code-edit",
    distributionShape: "mixed",
    riskClass: "high",
    successShape: "patch",
    contextPolicy: "work-case-packet",
    tokenEnvelope: {
      maxInputTokens: 64_000,
      maxOutputTokens: 8_000,
      compression: "strict-packet",
    },
    evaluationPolicy: { evaluator: "tool-success", minimumSignal: "no-regression" },
    requestContractHints: {
      taskType: "code-gen",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
      requiresCodeExecution: true,
    },
  },
  verify: {
    title: "Verify outcome",
    activityClass: "verify",
    distributionShape: "mixed",
    riskClass: "high",
    successShape: "evidence",
    contextPolicy: "work-case-packet",
    tokenEnvelope: STANDARD_TOKENS,
    evaluationPolicy: { evaluator: "tool-success", minimumSignal: "no-regression" },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
      requiresCodeExecution: true,
    },
  },
};

const DEFAULT_TASK_TYPE_BY_ACTIVITY: Record<ActivityClass, string> = {
  classify: "data-extraction",
  summarize: "summarization",
  extract: "data-extraction",
  synthesize: "reasoning",
  critique: "analysis",
  plan: "reasoning",
  "code-edit": "code-gen",
  "tool-act": "tool-action",
  verify: "analysis",
  handoff: "summarization",
};

type DefaultActivityPosture = {
  budgetClass: NonNullable<ActivityRouteContextHints["budgetClass"]>;
  reasoningDepth: NonNullable<ActivityRouteContextHints["reasoningDepth"]>;
  minimumTier: string;
};

const DEFAULT_POSTURE_BY_DISTRIBUTION: Record<
  ActivityDistributionShape,
  DefaultActivityPosture
> = {
  center: {
    budgetClass: "minimize_cost",
    reasoningDepth: "low",
    minimumTier: "adequate",
  },
  mixed: {
    budgetClass: "balanced",
    reasoningDepth: "medium",
    minimumTier: "strong",
  },
  edge: {
    budgetClass: "quality_first",
    reasoningDepth: "high",
    minimumTier: "frontier",
  },
};

const REASONING_DEPTH_RANK: Record<NonNullable<ActivityRouteContextHints["reasoningDepth"]>, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const RISK_REASONING_FLOOR: Record<
  ActivityRiskClass,
  NonNullable<ActivityRouteContextHints["reasoningDepth"]>
> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "high",
};

function buildActivityId(input: CompileBuildStudioPhaseActivityInput): string {
  const scope = input.parentRef.buildId ?? input.parentRef.taskRunId ?? "unknown";
  return `build:${scope}:${input.phase}`;
}

function buildCompoundActivityId(
  requestId: string,
  index: number,
  activityClass: CompoundActivityClass,
): string {
  return `request:${requestId}:${String(index + 1).padStart(2, "0")}:${activityClass}`;
}

function stricterReasoningDepth(
  left: NonNullable<ActivityRouteContextHints["reasoningDepth"]>,
  right: NonNullable<ActivityRouteContextHints["reasoningDepth"]>,
): NonNullable<ActivityRouteContextHints["reasoningDepth"]> {
  return REASONING_DEPTH_RANK[right] > REASONING_DEPTH_RANK[left] ? right : left;
}

export function compileBuildStudioPhaseActivity(
  input: CompileBuildStudioPhaseActivityInput,
): ActivityContract {
  const defaults = BUILD_STUDIO_PHASES[input.phase];
  return activityFromDefaults({
    activityId: buildActivityId(input),
    parentRef: input.parentRef,
    defaults,
  });
}

export function compileCompoundRequestActivities(
  input: CompileCompoundRequestActivitiesInput,
): ActivityContract[] {
  const prompt = input.prompt.toLowerCase();
  const sequence: CompoundActivityClass[] = [];

  if (mentionsAny(prompt, ["transcript", "video", "article", "distill", "summarize"])) {
    sequence.push("summarize");
  }

  if (mentionsAny(prompt, ["compare", "stack up", "architecture", "process", "review", "suggested"])) {
    sequence.push("critique");
  }

  if (mentionsAny(prompt, ["plan", "approach", "refine", "routing", "task", "activity"])) {
    sequence.push("plan");
  }

  if (
    input.requiresCodeChange ||
    input.requiresUiChange ||
    mentionsAny(prompt, ["implement", "build", "code", "refactor", "ui"])
  ) {
    sequence.push("code-edit");
  }

  if (input.requiresToolUse) {
    sequence.push("tool-act");
  }

  if (
    input.requiresCodeChange ||
    input.requiresUiChange ||
    mentionsAny(prompt, ["verify", "test", "evaluate", "outcome"])
  ) {
    sequence.push("verify");
  }

  sequence.push("handoff");

  return uniqueActivityClasses(sequence).map((activityClass, index) =>
    activityFromDefaults({
      activityId: buildCompoundActivityId(input.requestId, index, activityClass),
      parentRef: input.parentRef,
      defaults: COMPOUND_ACTIVITY_DEFAULTS[activityClass],
    }),
  );
}

function activityFromDefaults(input: {
  activityId: string;
  parentRef: ActivityParentRef;
  defaults: ActivityDefaults;
}): ActivityContract {
  const { defaults } = input;
  const sourceCodeActivity = defaults.activityClass === "code-edit" ||
    (defaults.activityClass === "verify" && defaults.requestContractHints.requiresCodeExecution === true);
  return {
    activityId: input.activityId,
    parentRef: input.parentRef,
    activityClass: defaults.activityClass,
    title: defaults.title,
    distributionShape: defaults.distributionShape,
    riskClass: defaults.riskClass,
    successShape: defaults.successShape,
    contextPolicy: defaults.contextPolicy,
    tokenEnvelope: { ...defaults.tokenEnvelope },
    evaluationPolicy: { ...defaults.evaluationPolicy },
    requestContractHints: { ...defaults.requestContractHints },
    ...(sourceCodeActivity
      ? {
          workloadClassHints: ["source-code" as const],
          governedData: {
            assetIds: ["data:source-code" as const],
            processingPurpose: "platform-operations" as const,
          },
        }
      : {}),
  };
}

function mentionsAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value.includes(pattern));
}

function uniqueActivityClasses(sequence: CompoundActivityClass[]): CompoundActivityClass[] {
  return sequence.filter((activityClass, index) => sequence.indexOf(activityClass) === index);
}

export function routeContextFromActivity(activity: ActivityContract): ActivityRouteContext {
  const posture = DEFAULT_POSTURE_BY_DISTRIBUTION[activity.distributionShape];
  const riskReasoning = RISK_REASONING_FLOOR[activity.riskClass];
  const reasoningDepth = stricterReasoningDepth(
    posture.reasoningDepth,
    riskReasoning,
  );
  return {
    activityId: activity.activityId,
    activityClass: activity.activityClass,
    distributionShape: activity.distributionShape,
    riskClass: activity.riskClass,
    successShape: activity.successShape,
    contextPolicy: activity.contextPolicy,
    maxInputTokens: activity.tokenEnvelope.maxInputTokens,
    maxOutputTokens: activity.tokenEnvelope.maxOutputTokens,
    compression: activity.tokenEnvelope.compression,
    taskType:
      activity.requestContractHints.taskType ??
      DEFAULT_TASK_TYPE_BY_ACTIVITY[activity.activityClass],
    ...posture,
    reasoningDepth,
    ...activity.requestContractHints,
    ...(activity.workloadClassHints
      ? { workloadClassHints: [...activity.workloadClassHints] }
      : {}),
    ...(activity.governedData
      ? {
          governedData: {
            ...activity.governedData,
            assetIds: [...activity.governedData.assetIds],
            ...(activity.governedData.fieldIds
              ? { fieldIds: [...activity.governedData.fieldIds] }
              : {}),
            ...(activity.governedData.applicableRegulationIds
              ? { applicableRegulationIds: [...activity.governedData.applicableRegulationIds] }
              : {}),
          },
        }
      : {}),
  };
}
