import { perspectiveForProfile } from "@/lib/decision-perspective/canvas";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";

export type FounderReviewUnresolvedReason =
  | "principle-gap"
  | "evidence-gap"
  | "domain-gap"
  | "ownership-gap"
  | "volunteers-dilemma";

// Re-export the canonical perspective type from PR #1343 so callers in this
// module don't need a second import. `null` represents "neither WWMD nor
// WWWD" — formerly the `"custom"` sentinel. The founder-review queue applies
// its own `?? "wwmd"` default (see `projectFounderReviewCandidate`) so a row
// with no profile information continues to render with founder-review wording.
export type { WikiPerspective };

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
  profile?: {
    profileId: string;
    name: string;
    kind: string;
  } | null;
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

function actionForReason(
  reason: FounderReviewUnresolvedReason,
  perspective: WikiPerspective,
): string {
  if (reason === "principle-gap" && perspective !== "wwmd") {
    return "Clarify operating policy";
  }
  return ACTION_BY_REASON[reason];
}

export function projectFounderReviewCandidate(row: DecisionInteractionQueueRow) {
  const payload = asRecord(row.outcomePayload);
  const unresolvedReason = normalizeReason(payload.unresolvedReason);
  // Default a missing profile to WWMD: the founder-review queue predates the
  // WWWD profile and a row with no profile is historically a Mark decision.
  const perspective: WikiPerspective = perspectiveForProfile(row.profile) ?? "wwmd";
  return {
    id: row.interactionId,
    question: row.question,
    options: Array.isArray(row.options) ? row.options : [],
    profileLabel: row.profile?.name ?? "WWMD Platform",
    perspective,
    unresolvedReason,
    unresolvedReasonLabel: LABEL_BY_REASON[unresolvedReason],
    primaryActionLabel: actionForReason(unresolvedReason, perspective),
    createdAt: row.createdAt.toISOString(),
    links: {
      buildHref: row.buildId ? `/build?buildId=${encodeURIComponent(row.buildId)}` : null,
      taskRunHref: row.taskRunId ? `/platform/ai/history?taskRunId=${encodeURIComponent(row.taskRunId)}` : null,
      decisionCanvasHref: `/platform/ai/decisions/${encodeURIComponent(row.interactionId)}`,
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
