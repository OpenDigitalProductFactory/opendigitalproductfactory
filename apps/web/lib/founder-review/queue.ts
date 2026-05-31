export type FounderReviewUnresolvedReason =
  | "principle-gap"
  | "evidence-gap"
  | "domain-gap"
  | "ownership-gap"
  | "volunteers-dilemma";

export type DecisionPerspectiveMode = "wwmd" | "wwwd" | "custom";

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

export function perspectiveModeForProfile(
  profile: DecisionInteractionQueueRow["profile"],
): DecisionPerspectiveMode {
  if (!profile) return "wwmd";
  const name = profile.name.toLowerCase();
  if (profile.kind === "platform" || name.includes("wwmd")) return "wwmd";
  if (
    profile.kind === "organization" ||
    profile.kind === "customer" ||
    profile.kind === "team" ||
    name.includes("wwwd")
  ) {
    return "wwwd";
  }
  return "custom";
}

function actionForReason(
  reason: FounderReviewUnresolvedReason,
  mode: DecisionPerspectiveMode,
): string {
  if (reason === "principle-gap" && mode !== "wwmd") {
    return "Clarify operating policy";
  }
  return ACTION_BY_REASON[reason];
}

export function projectFounderReviewCandidate(row: DecisionInteractionQueueRow) {
  const payload = asRecord(row.outcomePayload);
  const unresolvedReason = normalizeReason(payload.unresolvedReason);
  const perspectiveMode = perspectiveModeForProfile(row.profile);
  return {
    id: row.interactionId,
    question: row.question,
    options: Array.isArray(row.options) ? row.options : [],
    profileLabel: row.profile?.name ?? "WWMD Platform",
    perspectiveMode,
    unresolvedReason,
    unresolvedReasonLabel: LABEL_BY_REASON[unresolvedReason],
    primaryActionLabel: actionForReason(unresolvedReason, perspectiveMode),
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
