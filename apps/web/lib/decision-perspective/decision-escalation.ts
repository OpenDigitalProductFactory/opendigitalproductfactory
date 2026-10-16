import { resolveDecisionEscalation, type DecisionBasis, type DecisionDeclarations } from "@/lib/govern/authority/escalation-gate";
import type { DecisionPerspectiveEvaluationResult } from "./types";

/** BI-E27F3600 owns the qualified transition from this recorded R3 interim. */
export const INDEPENDENT_REVIEW_INTERIM: "proceed" | "hold" = "proceed";

type Evaluation = Pick<DecisionPerspectiveEvaluationResult, "outcomeType" | "riskTier"> & Partial<Pick<
  DecisionPerspectiveEvaluationResult,
  "evaluationFault" | "policyLimitExceeded" | "relevanceMethod" | "stanceAlignment" |
  "principleConflict" | "coverageGap" | "gapReason" | "constitutionalAlignment" | "escalation"
>>;

/** Classify recorded evaluator facts; no route or rationale parsing here. */
export function decisionBasisFor(evaluation: Evaluation): DecisionBasis {
  if (evaluation.evaluationFault) return "evaluation-fault";
  if (["recommend", "arbitrate", "decline"].includes(evaluation.outcomeType)) return "decided";
  if (evaluation.policyLimitExceeded || (
    evaluation.constitutionalAlignment?.verdict === "escalate"
    && evaluation.constitutionalAlignment.criteria.status !== "ambiguous"
  )) return "policy-limit";
  if (evaluation.relevanceMethod === "lexical") return "capability-gap";
  if (evaluation.coverageGap) return "corpus-gap";
  if (evaluation.stanceAlignment === "mixed" || evaluation.principleConflict) return "vector-gap";
  return "corpus-gap";
}

/** For new evaluations only. Legacy replay restores its persisted route. */
export function withDecisionEscalation<T extends Evaluation>(evaluation: T, declarations: DecisionDeclarations = {}) {
  const escalation = resolveDecisionEscalation({
    basis: decisionBasisFor(evaluation), riskTier: evaluation.riskTier, declarations,
  });
  return { ...evaluation, escalation, heldForIndependentReview: escalation.route === "independent-review" };
}

/** The single permission projection consumed by all decision gates. */
export function decisionAllowsStep(evaluation: Evaluation): boolean {
  const previouslyAllowed = evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate";
  // Absence is a historical fact, not a reason to re-evaluate old authority.
  if (!evaluation.escalation) return previouslyAllowed;
  if (evaluation.escalation.route === "human") return false;
  if (evaluation.outcomeType === "decline" || evaluation.stanceAlignment === "decline"
    || evaluation.constitutionalAlignment?.verdict === "decline") return false;
  if (evaluation.escalation.route === "independent-review") return INDEPENDENT_REVIEW_INTERIM === "proceed";
  return previouslyAllowed;
}

/** New routed results explain the actual next action; callers retain legacy copy. */
export function decisionEscalationMessage(evaluation: Evaluation): string | null {
  const escalation = evaluation.escalation;
  if (!escalation) return null;
  if (escalation.route === "human") {
    const reasons = {
      "damaging-critical-risk": "it carries critical risk",
      "damaging-consequence": "it declares an outward, irreversible or authority consequence",
      "damaging-threshold": "it crosses a configured threshold",
      "damaging-regulated": "a declared regulation requires human review",
    };
    return `This decision requires a person because ${reasons[escalation.reasonCode as keyof typeof reasons] ?? "its recorded route requires human review"}.`;
  }
  if (escalation.route === "independent-review") {
    const causes = { "corpus-gap": "insufficient corpus", "vector-gap": "conflicting guidance",
      "capability-gap": "a capability is unavailable", "policy-limit": "the delegated policy limit",
      "evaluation-fault": "evaluation is unavailable" };
    const cause = escalation.followOn ? causes[escalation.followOn] : "recorded cause unavailable";
    return `Independent review is outstanding (${cause}). ${decisionAllowsStep(evaluation)
      ? "The recorded interim permits this step within its existing authority."
      : "This step remains held."}`;
  }
  if (!decisionAllowsStep(evaluation)) return "The recorded decision is to decline; this step is not allowed.";
  return null;
}
