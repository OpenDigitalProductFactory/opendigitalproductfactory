// Content-aware directional outcome for the WWWD org business gate.
//
// Extracted from `evaluator.ts` (BI-F5F2869D) when that module crossed the
// 800-LOC ceiling. Behaviour is unchanged by the move: this is the same ladder,
// lifted whole, so the WWMD/content-blind path in the evaluator stays exactly
// where it was and this file holds one concern — how a recorded stance turns
// into a directional verdict.

import type {
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
} from "./types";
import { riskWithin, type ProfileCoverage } from "./coverage-scoring";

export type DirectionalOutcomeInput = {
  baseResult: Omit<DecisionPerspectiveEvaluationResult, "outcomeType" | "rationale">;
  selectedCoverage: ProfileCoverage;
  selectedProfile: DecisionPerspectiveProfile;
  confidence: number;
  input: { riskTier: DecisionRiskTier; relevanceMethod?: "semantic" | "lexical" };
};

/**
 * Returns the directional verdict, or null when the caller should fall through
 * to the content-blind ladder.
 */
export function contentAwareDirectionalOutcome(
  args: DirectionalOutcomeInput,
): DecisionPerspectiveEvaluationResult | null {
  const { baseResult, selectedCoverage, selectedProfile, confidence, input } = args;
  if (!selectedCoverage.contentAware) return null;

  const alignment = selectedCoverage.stanceAlignment ?? "none";

  // Lexical-fallback fail-safe (BI-7E1F128A follow-up). When the embedding
  // layer is unavailable, `computeStanceRelevance` scores relevance by coarse
  // lexical token-overlap. That signal is too imprecise to drive a confident
  // directional verdict: on a live install it spuriously matched a `support`
  // stance and confidently APPROVED a blatantly off-mission decision — strictly
  // worse than the pre-fix escalate, because it replaced "ask the owner" with
  // "act wrongly". So when relevance is lexical we do NOT act autonomously in
  // either direction; we escalate, exactly as the gate did before content
  // discrimination existed. Confident directional outcomes require semantic
  // relevance. (Restoring the embedding layer re-enables discrimination.)
  if (input.relevanceMethod === "lexical") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Your recorded stance leans ${alignment} on this decision, but relevance was scored without the semantic embedding layer (lexical fallback) — too coarse to decide this on your behalf. Escalating to your call; restore embeddings to re-enable autonomous stance-grounded verdicts.`,
    };
  }

  // Conflict is judged by RELEVANCE-WEIGHTED direction (`mixed`), not the
  // coarse content-blind `principleConflict` — otherwise a domain that merely
  // *contains* an opposing principle would escalate every decision even when
  // only one side is relevant to the question. `principleConflict` is still
  // recorded on the result for audit.
  if (alignment === "mixed") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        "Your recorded stance points in conflicting directions on this decision. Escalating to your call, and the resolution becomes candidate stance material.",
    };
  }

  if (input.riskTier === "critical") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `This is a critical-risk decision, so it goes to your call even though your recorded stance leans ${alignment} at confidence ${confidence}.`,
    };
  }

  if (
    alignment === "none"
    || confidence < selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation
  ) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Your recorded stance does not clearly speak to this decision (alignment ${alignment}, confidence ${confidence} below the ${selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation} threshold). Escalating to your call.`,
      gapReason: "material-below-confidence",
    };
  }

  if (alignment === "decline") {
    return {
      ...baseResult,
      outcomeType: "recommend",
      rationale:
        `Recommend DECLINING: your recorded stance opposes this decision at confidence ${confidence}. Declining an off-stance option is low-consequence, so this does not require your live call.`,
    };
  }

  // alignment === "approve".
  //
  // Aligned is NOT a licence to act (BI-F5F2869D, operator ruling). Approving
  // whatever matches recorded doctrine would make the business only ever do
  // what it already does, and reviewing an unaligned or novel proposal is
  // exactly where new ideas surface. So an approval acts autonomously only
  // when the owner has ALREADY RULED on this question — a `ruled` stance
  // dominating the relevant material — and otherwise escalates with the
  // reason made explicit, so a genuinely new proposition is legible as new
  // rather than buried among settled ones.
  if (!selectedCoverage.settledByRuling) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `This is a NEW proposition: your recorded stance is consistent with it (confidence ${confidence}), but you have not ruled on this question before. Escalating so you can weigh it — a decision that merely matches existing doctrine is not one you have already made.`,
      gapReason: "aligned-not-settled",
    };
  }

  if (input.riskTier === "high") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Your recorded stance supports this at confidence ${confidence}, but approving a high-risk decision still needs your live call.`,
    };
  }
  if (
    selectedProfile.autonomyPolicy.allowArbitration
    && riskWithin(input.riskTier, selectedProfile.autonomyPolicy.maxRiskForArbitration)
    && confidence >= selectedProfile.autonomyPolicy.minimumConfidenceForArbitration
  ) {
    return {
      ...baseResult,
      outcomeType: "arbitrate",
      rationale:
        `Arbitrate and proceed: your recorded stance supports this at confidence ${confidence} and the autonomy policy allows arbitration at ${input.riskTier} risk.`,
    };
  }
  return {
    ...baseResult,
    outcomeType: "recommend",
    rationale:
      `Recommend APPROVING: your recorded stance supports this decision at confidence ${confidence}.`,
  };

  return null;
}
