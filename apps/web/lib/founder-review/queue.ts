export type FounderReviewUnresolvedReason =
  | "principle-gap"
  | "evidence-gap"
  | "domain-gap"
  | "ownership-gap"
  | "volunteers-dilemma";

export type DecisionInteractionQueueRow = {
  interactionId: string;
  question: string;
  options: unknown;
  outcomeType: string;
  outcomePayload: unknown;
  buildId: string | null;
  taskRunId: string | null;
  routeContext: string | null;
  createdAt: Date;
};

export type FounderReviewCandidate = ReturnType<typeof projectFounderReviewCandidate>;

const ACTION_BY_REASON: Record<FounderReviewUnresolvedReason, string> = {
  "principle-gap": "Clarify founder principle",
  "evidence-gap": "Request better evidence",
  "domain-gap": "Route to domain owner",
  "ownership-gap": "Assign an accountable owner",
  "volunteers-dilemma": "Choose the responsible volunteer path",
};

const LABEL_BY_REASON: Record<FounderReviewUnresolvedReason, string> = {
  "principle-gap": "Principle gap",
  "evidence-gap": "Evidence gap",
  "domain-gap": "Domain gap",
  "ownership-gap": "Ownership gap",
  "volunteers-dilemma": "Volunteer's dilemma",
};

const KNOWN_REASONS = new Set<FounderReviewUnresolvedReason>([
  "principle-gap",
  "evidence-gap",
  "domain-gap",
  "ownership-gap",
  "volunteers-dilemma",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeReason(value: unknown): FounderReviewUnresolvedReason {
  return typeof value === "string" && KNOWN_REASONS.has(value as FounderReviewUnresolvedReason)
    ? value as FounderReviewUnresolvedReason
    : "principle-gap";
}

export function projectFounderReviewCandidate(row: DecisionInteractionQueueRow) {
  const payload = asRecord(row.outcomePayload);
  const unresolvedReason = normalizeReason(payload.unresolvedReason);
  return {
    id: row.interactionId,
    question: row.question,
    options: Array.isArray(row.options) ? row.options : [],
    unresolvedReason,
    unresolvedReasonLabel: LABEL_BY_REASON[unresolvedReason],
    primaryActionLabel: ACTION_BY_REASON[unresolvedReason],
    createdAt: row.createdAt.toISOString(),
    links: {
      buildHref: row.buildId ? `/build?buildId=${encodeURIComponent(row.buildId)}` : null,
      taskRunHref: row.taskRunId ? `/platform/ai/history?taskRunId=${encodeURIComponent(row.taskRunId)}` : null,
      routeContext: row.routeContext,
    },
  };
}

export function groupFounderReviewCandidates(candidates: FounderReviewCandidate[]) {
  const groups = new Map<string, FounderReviewCandidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.unresolvedReasonLabel, [
      ...(groups.get(candidate.unresolvedReasonLabel) ?? []),
      candidate,
    ]);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}
