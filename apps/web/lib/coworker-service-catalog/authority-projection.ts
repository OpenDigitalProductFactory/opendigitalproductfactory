import {
  LEVEL_PRESENTATION,
  type CoworkerAuthorityProjection,
  type CoworkerAuthorityProjectionInput,
} from "./authority-projection-contract";
import {
  collectProjectionEvidence,
  createProjectionWork,
  strictest,
  unique,
} from "./authority-projection-sources";

export * from "./authority-projection-contract";

export function projectCoworkerAuthority(
  input: CoworkerAuthorityProjectionInput,
): CoworkerAuthorityProjection {
  const work = createProjectionWork();
  const scope = collectProjectionEvidence(input, work);

  if (work.candidates.length === 0 && work.errors.length === 0) {
    work.errors.push("No authority default could be resolved");
  }

  if (work.errors.length > 0) {
    return {
      state: "review-needed",
      scope,
      level: null,
      label: "Approval rules need review",
      summary: "The current approval evidence is incomplete or contradictory.",
      ownerReason:
        "The platform cannot safely summarize this coworker's approval rules yet.",
      ownerAction: "Review the supporting rules before relying on this label.",
      reasons: unique(work.errors),
      evidence: work.evidence,
    };
  }

  const winner = strictest(work.candidates);
  const presentation = LEVEL_PRESENTATION[winner.normalizedLevel];
  const { specificity: _specificity, ownerReason, ownerAction, ...publicWinner } =
    winner;
  return {
    state: "resolved",
    scope,
    level: winner.normalizedLevel,
    label: presentation.label,
    summary:
      scope.kind === "default-posture"
        ? presentation.defaultSummary
        : presentation.actionSummary,
    ownerReason,
    ownerAction,
    winner: publicWinner,
    evidence: work.evidence,
  };
}
