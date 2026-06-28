import type { RoutedExecutionPlan } from "./recipe-types";
import type {
  ActivityClass,
  ActivityContract,
  ActivityDistributionShape,
  ActivityEvaluationPolicy,
} from "./activity-contract";
import type { ActivityHarnessConfidenceOverride } from "./activity-harness-governance";

export type HarnessRecipeConfidence =
  | "provisional"
  | "calibrating"
  | "trusted"
  | "degraded";

export type HarnessRecipe = {
  recipeKey: string;
  activityClass: ActivityClass;
  distributionShape: ActivityDistributionShape;
  providerFamily?: string;
  modelFamily?: string;
  executionAdapterHint?: string;
  promptStrategy: string;
  contextAssembler: string;
  memoryPolicy: "none" | "thread-summary" | "work-case-packet" | "retrieval-packet";
  toolPolicy: RoutedExecutionPlan["toolPolicy"];
  responsePolicy: RoutedExecutionPlan["responsePolicy"];
  tokenPolicy: {
    inputPacking: "minimal" | "ranked-evidence" | "full-context" | "compressed";
    outputBudget: "tight" | "standard" | "expansive";
  };
  evaluator: ActivityEvaluationPolicy["evaluator"];
  activityConfidence: HarnessRecipeConfidence;
};

export type HarnessBindingHint = {
  providerId?: string | null;
  modelId?: string | null;
};

export function bindHarnessRecipeForActivity(
  activity: ActivityContract,
  hint: HarnessBindingHint = {},
): HarnessRecipe {
  if (isGlmHint(hint)) {
    return buildGlmRecipe(activity);
  }

  if (activity.activityClass === "code-edit" && isHighRisk(activity)) {
    return {
      recipeKey: "high-risk.code-edit.frontier-coding",
      activityClass: activity.activityClass,
      distributionShape: activity.distributionShape,
      providerFamily: "frontier",
      promptStrategy: "repo-packet-with-verification",
      contextAssembler: "work-case-repo-packet",
      memoryPolicy: "work-case-packet",
      toolPolicy: { toolChoice: "auto", allowParallelToolCalls: false },
      responsePolicy: { strictSchema: false, stream: true },
      tokenPolicy: { inputPacking: "full-context", outputBudget: "expansive" },
      evaluator: "tool-success",
      activityConfidence: "trusted",
    };
  }

  if (activity.distributionShape === "center") {
    return {
      recipeKey: `center.${activity.activityClass}.cheap-structured`,
      activityClass: activity.activityClass,
      distributionShape: activity.distributionShape,
      promptStrategy: "concise-task-packet",
      contextAssembler: "minimal-ranked-context",
      memoryPolicy: "thread-summary",
      toolPolicy: {},
      responsePolicy: { strictSchema: activity.successShape === "json" },
      tokenPolicy: { inputPacking: "compressed", outputBudget: "tight" },
      evaluator: activity.evaluationPolicy.evaluator,
      activityConfidence: "calibrating",
    };
  }

  return {
    recipeKey: `${activity.distributionShape}.${activity.activityClass}.balanced`,
    activityClass: activity.activityClass,
    distributionShape: activity.distributionShape,
    promptStrategy: "standard-activity-packet",
    contextAssembler: "ranked-evidence-context",
    memoryPolicy: activity.contextPolicy === "work-case-packet" ? "work-case-packet" : "retrieval-packet",
    toolPolicy: activity.activityClass === "tool-act" ? { toolChoice: "auto" } : {},
    responsePolicy: { strictSchema: activity.successShape === "json", stream: true },
    tokenPolicy: { inputPacking: "ranked-evidence", outputBudget: "standard" },
    evaluator: activity.evaluationPolicy.evaluator,
    activityConfidence: "calibrating",
  };
}

export function applyHarnessConfidenceOverride(
  recipe: HarnessRecipe,
  hint: HarnessBindingHint,
  overrides: ActivityHarnessConfidenceOverride[] = [],
): HarnessRecipe {
  const approvedOverride = overrides.find((override) =>
    override.activityClass === recipe.activityClass &&
    override.harnessRecipeKey === recipe.recipeKey &&
    override.providerId === hint.providerId &&
    override.modelId === (hint.modelId ?? null),
  );

  if (!approvedOverride) return recipe;

  return {
    ...recipe,
    activityConfidence: approvedOverride.confidence,
  };
}

export function isGlmHarnessRecipe(recipe: HarnessRecipe): boolean {
  return recipe.providerFamily === "zai" && recipe.modelFamily === "glm";
}

function buildGlmRecipe(activity: ActivityContract): HarnessRecipe {
  return {
    recipeKey: `glm.${activity.distributionShape}.${activity.activityClass}.provisional`,
    activityClass: activity.activityClass,
    distributionShape: activity.distributionShape,
    providerFamily: "zai",
    modelFamily: "glm",
    executionAdapterHint: activity.activityClass === "code-edit" ? "opencode" : undefined,
    promptStrategy: "glm-center-distribution-packet",
    contextAssembler: "minimal-ranked-context",
    memoryPolicy: activity.contextPolicy === "work-case-packet" ? "work-case-packet" : "thread-summary",
    toolPolicy: activity.activityClass === "tool-act" ? { toolChoice: "auto" } : {},
    responsePolicy: { strictSchema: activity.successShape === "json", stream: true },
    tokenPolicy: {
      inputPacking: activity.tokenEnvelope.compression === "none" ? "ranked-evidence" : "compressed",
      outputBudget: activity.distributionShape === "center" ? "tight" : "standard",
    },
    evaluator: activity.evaluationPolicy.evaluator,
    activityConfidence: "provisional",
  };
}

function isHighRisk(activity: ActivityContract): boolean {
  return activity.riskClass === "high" || activity.riskClass === "critical";
}

function isGlmHint(hint: HarnessBindingHint): boolean {
  const provider = hint.providerId?.toLowerCase() ?? "";
  const model = hint.modelId?.toLowerCase() ?? "";
  return provider.startsWith("zai") || model.includes("glm");
}
