import { executeTool } from "@/lib/mcp-tools";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type BuildStudioDecisionSource = "build-studio" | "claude" | "codex" | "coworker";
export type BuildStudioDecisionStatus = "recommended" | "needs-human" | "captured-gap" | "blocked";

export type BuildStudioDecisionOption = {
  id: string;
  description: string;
  operatorLabel?: string;
  features?: Record<string, number>;
};

export type BuildStudioDecisionRequest = {
  source: BuildStudioDecisionSource;
  routeContext: string;
  buildId?: string;
  taskRunId?: string;
  phase?: string;
  question: string;
  options: BuildStudioDecisionOption[];
};

export type BuildStudioDecisionRecommendation = {
  optionId: string;
  confidence: string;
  margin: number;
};

export type BuildStudioDecisionResult = {
  status: BuildStudioDecisionStatus;
  recommendation?: BuildStudioDecisionRecommendation;
  reasonSummary: string;
  operatorActionLabel: string;
  auditSummary: string;
};

export type BuildStudioDecisionToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  context: Record<string, unknown>,
) => Promise<{ success?: boolean; data?: Record<string, unknown>; error?: string }>;

function callingPopulationFor(source: BuildStudioDecisionSource) {
  return source === "build-studio" || source === "coworker"
    ? "in_platform_coworker"
    : "external_coding_agent";
}

function contextFor(request: BuildStudioDecisionRequest): Record<string, unknown> {
  return {
    routeContext: request.routeContext,
    ...(request.buildId ? { featureBuildId: request.buildId } : {}),
    ...(request.taskRunId ? { taskRunId: request.taskRunId } : {}),
  };
}

function labelFromOption(option: BuildStudioDecisionOption | undefined, fallback: string) {
  if (!option) return fallback;
  return option.operatorLabel ?? option.description.replace(/\.$/, "");
}

function sanitizeOperatorSummary(value: unknown, fallback: string) {
  const text = typeof value === "string" && value.trim().length > 0 ? value : fallback;
  return text
    .replace(/\bprinciple_decide\b/gi, "the decision service")
    .replace(/\bmcp\b/gi, "governed tools")
    .replace(/\bdpf-[a-z0-9-]+\b/gi, "the matching DPF skill");
}

function readRecommendation(data: Record<string, unknown> | undefined): BuildStudioDecisionRecommendation | undefined {
  const raw = data?.recommendation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const recommendation = raw as Record<string, unknown>;
  if (
    typeof recommendation.optionId !== "string"
    || typeof recommendation.confidence !== "string"
    || typeof recommendation.margin !== "number"
  ) {
    return undefined;
  }
  return {
    optionId: recommendation.optionId,
    confidence: recommendation.confidence,
    margin: recommendation.margin,
  };
}

function hasCommandmentConflict(data: Record<string, unknown> | undefined): boolean {
  const flags = data?.flags;
  return !!flags
    && typeof flags === "object"
    && !Array.isArray(flags)
    && (flags as Record<string, unknown>).commandmentConflict === true;
}

function errorMessage(error: unknown): string {
  return getErrorMessage(error);
}

export async function evaluateBuildStudioDecision(input: {
  request: BuildStudioDecisionRequest;
  userId: string;
  toolExecutor?: BuildStudioDecisionToolExecutor;
}): Promise<BuildStudioDecisionResult> {
  const toolExecutor = input.toolExecutor ?? executeTool;
  let response: Awaited<ReturnType<BuildStudioDecisionToolExecutor>>;
  try {
    response = await toolExecutor(
      "principle_decide",
      {
        context: input.request.question,
        callingPopulation: callingPopulationFor(input.request.source),
        options: input.request.options,
      },
      input.userId,
      contextFor(input.request),
    );
  } catch (error) {
    return {
      status: "captured-gap",
      reasonSummary: sanitizeOperatorSummary(errorMessage(error), "WWMD did not return a decision."),
      operatorActionLabel: "Send to founder review",
      auditSummary: "Decision service could not obtain a governed recommendation.",
    };
  }

  if (!response.success) {
    return {
      status: "captured-gap",
      reasonSummary: sanitizeOperatorSummary(response.error, "WWMD did not return a decision."),
      operatorActionLabel: "Send to founder review",
      auditSummary: "Decision service could not obtain a governed recommendation.",
    };
  }

  const recommendation = readRecommendation(response.data);
  if (hasCommandmentConflict(response.data)) {
    return {
      status: "blocked",
      recommendation,
      reasonSummary: sanitizeOperatorSummary(response.data?.reasoning, "A commandment blocks this decision."),
      operatorActionLabel: "Resolve blocker before continuing",
      auditSummary: `Blocked by governed decision response for ${input.request.question}.`,
    };
  }

  if (!recommendation || recommendation.confidence !== "high") {
    return {
      status: "needs-human",
      recommendation,
      reasonSummary: sanitizeOperatorSummary(response.data?.reasoning, "WWMD requires an owner review."),
      operatorActionLabel: "Ask for an owner decision",
      auditSummary: `Decision requires owner review for ${input.request.question}.`,
    };
  }

  const recommendedOption = input.request.options.find((option) => option.id === recommendation.optionId);
  return {
    status: "recommended",
    recommendation,
    reasonSummary: sanitizeOperatorSummary(response.data?.reasoning, `WWMD recommends ${recommendation.optionId}.`),
    operatorActionLabel: labelFromOption(recommendedOption, "Use recommended option"),
    auditSummary: `Governed decision recommended ${recommendation.optionId} with ${recommendation.confidence} confidence.`,
  };
}
