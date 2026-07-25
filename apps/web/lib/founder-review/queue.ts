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
  domainClass?: string | null;
  /** Which governance gate produced the row (BI-1BE30A9A). Advisory gates never
   *  produce founder-actionable residue — see isFounderActionable. */
  gateKey?: string | null;
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

export function isBlankFounderReviewQuestion(row: Pick<DecisionInteractionQueueRow, "question">): boolean {
  return row.question.trim().length === 0;
}

/**
 * Does this decision belong in front of the founder? (BI-6EC1EE25)
 *
 * The founder-review and attention queues were inclusion-by-default: every
 * escalate/defer row was residue unless it matched a hardcoded deny-list of
 * "agent-internal noise", duplicated verbatim across three files. That list was
 * built for principle_decide consults (BI-9026B96C) and silently failed to
 * exclude the next class that fit the same description — the fail-open
 * profession/WSID advisory reviews (BI-D6CFE63A) — which then flooded the queue.
 *
 * This derives founder-actionability from what produced the row, so a new
 * advisory or agent-internal writer cannot re-pollute by default. A decision is
 * NOT founder-actionable when:
 *
 *  - it is a profession/WSID gate row. That gate is advisory by contract — it
 *    returns a recommendation and blocks nothing. A craft "defer" means the
 *    craft corpus is empty, which is a ProfessionCorpusGap signal, not a
 *    question the founder answers. True regardless of build/task linkage:
 *    advisory is advisory.
 *  - it is an already-executed agent-internal kernel consult: an unlinked
 *    principle_decide / kernel-consult row (BI-9026B96C). Audit-visible, not
 *    residue. A build/task link means it gated real work, so it stays.
 *
 * Everything else — build-studio plan gates, WWWD org-business stance gaps,
 * anything genuinely awaiting a human — is founder-actionable.
 */
export function isFounderActionable(row: Pick<
  DecisionInteractionQueueRow,
  "buildId" | "taskRunId" | "routeContext" | "domainClass" | "gateKey"
>): boolean {
  if ((row.gateKey ?? "").trim().toLowerCase() === "profession") return false;

  const linked = Boolean(row.buildId || row.taskRunId);
  if (!linked) {
    const route = (row.routeContext ?? "").trim().toLowerCase();
    if (route === "mcp:principle_decide" || route.startsWith("mcp:principle_decide")) return false;
    const domain = (row.domainClass ?? "").trim().toLowerCase();
    if (domain === "kernel-consult") return false;
  }
  return true;
}

/**
 * @deprecated Use `!isFounderActionable(row)`. Retained as the exact inverse so
 * the migration is behaviour-preserving for the agent-internal case; new
 * callers must not add to a deny-list. BI-6EC1EE25.
 */
export function isAgentInternalFounderReviewNoise(row: Pick<
  DecisionInteractionQueueRow,
  "buildId" | "taskRunId" | "routeContext" | "domainClass" | "gateKey"
>): boolean {
  return !isFounderActionable(row);
}

function normalizeFounderReviewQuestion(question: string): string {
  return question.trim().replace(/\s+/g, " ").toLowerCase();
}

export function dedupeFounderReviewCandidates<T extends FounderReviewCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.perspective ?? "unknown",
      candidate.profileLabel.trim().toLowerCase(),
      normalizeFounderReviewQuestion(candidate.question),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

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
