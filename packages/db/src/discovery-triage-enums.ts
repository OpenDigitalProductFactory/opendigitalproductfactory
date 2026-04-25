export const TRIAGE_ACTOR_TYPES = ["agent", "human", "system"] as const;
export type TriageActorType = (typeof TRIAGE_ACTOR_TYPES)[number];

export const TRIAGE_OUTCOMES = [
  "auto-attributed",
  "human-review",
  "needs-more-evidence",
  "taxonomy-gap",
  "dismissed",
] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];

export const TRIAGE_QUALITY_ISSUE_TYPES = [
  "attribution",
  "stale-identity",
  "missing-taxonomy",
] as const;
export type TriageQualityIssueType = (typeof TRIAGE_QUALITY_ISSUE_TYPES)[number];
