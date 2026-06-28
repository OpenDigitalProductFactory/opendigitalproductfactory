import type { RequestContract } from "./request-contract";

export type ActivityClass =
  | "classify"
  | "summarize"
  | "extract"
  | "synthesize"
  | "critique"
  | "plan"
  | "code-edit"
  | "tool-act"
  | "verify"
  | "handoff";

export type ActivityDistributionShape = "center" | "mixed" | "edge";

export type ActivityRiskClass = "low" | "medium" | "high" | "critical";

export type ActivitySuccessShape =
  | "text"
  | "json"
  | "patch"
  | "decision"
  | "tool-result"
  | "evidence";

export type ActivityContextPolicy =
  | "minimal"
  | "retrieval"
  | "full-thread"
  | "work-case-packet";

export type ActivityParentRef = {
  taskRunId?: string;
  taskNodeId?: string;
  workCaseId?: string;
  buildId?: string;
  patternKey?: string;
};

export type ActivityTokenEnvelope = {
  maxInputTokens: number;
  maxOutputTokens: number;
  compression: "none" | "summarize" | "cite-sources" | "strict-packet";
};

export type ActivityEvaluationPolicy = {
  evaluator: "schema" | "tool-success" | "review" | "golden" | "human-acceptance";
  minimumSignal: "valid-output" | "accepted" | "review-passed" | "no-regression";
};

export type ActivityRouteContextHints = {
  taskType?: string;
  budgetClass?: RequestContract["budgetClass"];
  reasoningDepth?: RequestContract["reasoningDepth"];
  minimumTier?: string;
  minimumDimensions?: Record<string, number>;
  residencyPolicy?: RequestContract["residencyPolicy"];
  requiresCodeExecution?: boolean;
  requiresWebSearch?: boolean;
  requiresComputerUse?: boolean;
};

export type ActivityContract = {
  activityId: string;
  parentRef: ActivityParentRef;
  activityClass: ActivityClass;
  title: string;
  distributionShape: ActivityDistributionShape;
  riskClass: ActivityRiskClass;
  successShape: ActivitySuccessShape;
  contextPolicy: ActivityContextPolicy;
  tokenEnvelope: ActivityTokenEnvelope;
  evaluationPolicy: ActivityEvaluationPolicy;
  requestContractHints: ActivityRouteContextHints;
};

export type ActivityRouteContext = ActivityRouteContextHints & {
  activityId: string;
  activityClass: ActivityClass;
  distributionShape: ActivityDistributionShape;
  riskClass: ActivityRiskClass;
  successShape: ActivitySuccessShape;
  contextPolicy: ActivityContextPolicy;
  maxInputTokens: number;
  maxOutputTokens: number;
  compression: ActivityTokenEnvelope["compression"];
};
