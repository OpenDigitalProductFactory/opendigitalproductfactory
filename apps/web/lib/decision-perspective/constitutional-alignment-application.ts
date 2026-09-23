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
    return;
  }

  if (alignment.verdict === "escalate") {
    // An ambiguous PARSE is not a corpus FINDING (BI-9E1E1939).
    //
    // `extractAlignmentCriteria` recognises a fixed vocabulary; a question
    // outside it yields `status: "ambiguous"`, and `evaluateConstitutionalAlignment`
    // then returns `escalate` with `checks: []` — WITHOUT having consulted a
    // single corpus. Treating that as a veto overwrote the directional verdict
    // the coverage path had already measured semantically, which is how 62 of 63
    // unresolved escalations on the customer 0 install were produced, all
    // wearing an identical confidence the gate had computed and then discarded.
    //
    // A veto is for a boundary the corpora actually detected. Failing to parse
    // the question is not that, so we ABSTAIN: the alignment result is still
    // recorded for audit, and the measured verdict stands on its own evidence.
    // This is not a loosening — the off-stance decline above still fires, and an
    // approve-direction verdict still faces the settled-ruling gate downstream.
    if (alignment.criteria.status === "ambiguous") return;

    evaluation.outcomeType = "escalate";
    // Only assert "none" when the coverage path measured nothing. Overwriting a
    // real measurement made the recorded reason untrue, so the review queue
    // showed "no stance applies" beside a confidence derived from a stance that
    // did apply.
    evaluation.stanceAlignment ??= "none";
    evaluation.rationale =
      "Constitutional alignment could not be established from complete criteria and all required corpora; escalating rather than inventing fit.";
    return;
  }

  evaluation.stanceAlignment = "approve";
  evaluation.alignmentScore = 1;
}
