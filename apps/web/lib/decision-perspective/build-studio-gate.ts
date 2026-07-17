import type {
  BuildDeliberationSummary,
  BuildPhase,
  ReviewResult,
} from "@/lib/feature-build-types";
import { evaluatePerspectiveGate } from "./evaluator";
import type {
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
} from "./types";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";
import { runVoiceSynthesisJob } from "../voice-synthesis/synthesis-job";

type BuildStudioGateClient = any;
type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;

export type BuildStudioDecisionGateResult = {
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
};

export type BuildStudioPlanAdvancementBuild = {
  buildId: string;
  title: string;
  phase?: BuildPhase;
  planReview: ReviewResult | null;
  deliberationSummary: BuildDeliberationSummary | null;
};

function planAdvancementQuestion(build: BuildStudioPlanAdvancementBuild): string {
  return `Start implementation for "${build.title}" from the reviewed Build Studio plan?`;
}

function planAdvancementOptions(): string[] {
  return [
    "Start implementation",
    "Revise the implementation plan",
    "Escalate to the Build Studio owner",
  ];
}

export async function evaluateBuildStudioPlanAdvancementGate(input: {
  db: BuildStudioGateClient;
  build: BuildStudioPlanAdvancementBuild;
  profileId?: string;
  recentOverrideCount?: number;
  triggeredByUserId?: string | null;
  evaluator?: GateEvaluator;
  now?: Date;
  riskTier?: DecisionRiskTier;
}): Promise<BuildStudioDecisionGateResult> {
  const question = planAdvancementQuestion(input.build);
  const options = planAdvancementOptions();
  const riskTier = input.riskTier ?? "medium";

  const result = await evaluatePerspectiveGate({
    db: input.db,
    profileId: input.profileId,
    question,
    options,
    domainClass: PLAN_READINESS_DOMAIN_CLASS,
    riskTier,
    routeContext: "/build",
    build: input.build,
    triggeredByUserId: input.triggeredByUserId,
    recentOverrideCount: input.recentOverrideCount,
    evaluator: input.evaluator,
    now: input.now,
    onComplete: (interactionId) => {
      runVoiceSynthesisJob(interactionId).catch((err: unknown) => {
        console.info("[tool-trace] wwmd.voice.dispatch.failed", { interactionId, error: String(err) });
      });
    },
  });

  return {
    allowed: result.allowed,
    interactionId: result.interactionId,
    evaluation: result.evaluation,
    operatorMessage: result.operatorMessage,
  };
}
