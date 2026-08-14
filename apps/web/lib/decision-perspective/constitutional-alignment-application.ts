import {
  evaluateConstitutionalAlignment,
  type AlignmentCorpora,
} from "./alignment-criteria";
import type { DecisionPerspectiveEvaluationResult } from "./types";

/** Apply independent corpus veto semantics to an already-computed WWWD evaluation. */
export function applyConstitutionalAlignment(input: {
  evaluation: DecisionPerspectiveEvaluationResult;
  question: string;
  corpora: AlignmentCorpora;
}): void {
  const alignment = evaluateConstitutionalAlignment({
    statement: input.question,
    corpora: input.corpora,
  });
  const evaluation = input.evaluation;
  evaluation.constitutionalAlignment = alignment;
  if (alignment.verdict === "decline" && alignment.veto) {
    evaluation.outcomeType = "recommend";
    evaluation.stanceAlignment = "decline";
    evaluation.alignmentScore = -1;
    evaluation.rationale =
      `Recommend DECLINING: ${alignment.veto.corpus} rejects the ` +
      `${alignment.veto.criterion} criterion. ${alignment.veto.rationale}`;
  } else if (alignment.verdict === "escalate") {
    evaluation.outcomeType = "escalate";
    evaluation.stanceAlignment = "none";
    evaluation.rationale =
      "Constitutional alignment could not be established from complete criteria and all required corpora; escalating rather than inventing fit.";
  } else {
    evaluation.stanceAlignment = "approve";
    evaluation.alignmentScore = 1;
  }
}
