// Auto-resolve stale build-stall escalations (BI-467E8F8D, EP-INTAKE-UNIFY).
//
// Build-stall escalations (PlatformIssueReport type=build-stall-escalation, born
// awaiting_escalation_ack via escalateBuildToHuman) have a CREATE path but no
// CLEAR path — nothing ever resolves them, so they pile up on /ops and read as
// noise long after the underlying work is done, dropped, or re-attempted. This is
// the same create-only gap the assurance lane just closed in BI-4D5C702F (a
// finding lingers forever because persist only touches findings PRESENT in a
// scan); the cure is the same shape: a conservative reconcile that resolves an
// escalation once its originating work is provably no longer a pending human
// decision.
//
// PURE: given joined rows (escalation + its build's supersede marker + the
// originating BacklogItem's status/triageOutcome), decide which to resolve and
// why. The DB read/write lives in escalation-hygiene-runner.ts so this stays
// trivially unit-testable.

/** Originating-item triage outcomes that mean the work will NOT be done. */
const WONT_DO_TRIAGE_OUTCOMES = new Set(["discard", "duplicate"]);

/**
 * Backlog statuses that mean the originating work is still a live, pending
 * decision — an escalation against one of these is NOT stale and is kept.
 *
 * `deferred` is deliberately NOT in this set, and also NOT treated as stale:
 * a `deferred` item spans BOTH "parked, still wanted" (triageOutcome build /
 * runbook / coworker-task / defer) AND "discarded" (triageOutcome discard /
 * duplicate). The won't-do case is caught by triageOutcome below; everything
 * else deferred is the genuine "waiting for a human" state and is kept.
 */
const PENDING_BACKLOG_STATUSES = new Set(["triaging", "open", "in-progress"]);

export interface EscalationStalenessRow {
  reportId: string;
  /** Escalation birth time — the newest open escalation per BI wins a re-attempt tie. */
  createdAt: Date;
  /** FeatureBuild.supersededByEpicId — set when a decompose was approved (build handled). */
  buildSupersededByEpicId: string | null;
  /** Originating BacklogItem.id (FeatureBuild.originatingBacklogItemId), or null if unlinked. */
  originatingBacklogItemId: string | null;
  /** Originating BacklogItem.status, or null if unlinked/missing. */
  backlogItemStatus: string | null;
  /** Originating BacklogItem.triageOutcome, or null. */
  backlogItemTriageOutcome: string | null;
}

export interface ResolvableEscalation {
  reportId: string;
  /** Stable machine reason for the auto-resolve, surfaced in logs/telemetry. */
  reason:
    | "build-superseded-by-epic"
    | "superseded-by-newer-escalation"
    | "originating-item-done"
    | "originating-item-wont-do";
}

/**
 * Select the escalations that are safe to auto-resolve, with a reason each.
 * Conservative by construction: an escalation is resolved only when its
 * originating work is provably no longer a pending human decision. Anything
 * still triaging / open / in-progress, or deferred-and-still-wanted, or with no
 * resolvable originating link, is left alone.
 */
export function selectResolvableEscalations(
  rows: EscalationStalenessRow[],
): ResolvableEscalation[] {
  // Newest open escalation per originating BI — older escalations for the same
  // item are residue of a superseded re-attempt.
  const newestByItem = new Map<string, EscalationStalenessRow>();
  for (const row of rows) {
    if (!row.originatingBacklogItemId) continue;
    const cur = newestByItem.get(row.originatingBacklogItemId);
    if (!cur || row.createdAt.getTime() > cur.createdAt.getTime()) {
      newestByItem.set(row.originatingBacklogItemId, row);
    }
  }

  const out: ResolvableEscalation[] = [];
  for (const row of rows) {
    const reason = resolveReason(row, newestByItem);
    if (reason) out.push({ reportId: row.reportId, reason });
  }
  return out;
}

function resolveReason(
  row: EscalationStalenessRow,
  newestByItem: Map<string, EscalationStalenessRow>,
): ResolvableEscalation["reason"] | null {
  // The decompose was approved → the build was superseded by an epic, so the
  // escalation raised against the now-superseded build is handled.
  if (row.buildSupersededByEpicId) return "build-superseded-by-epic";

  const itemId = row.originatingBacklogItemId;
  if (!itemId) return null; // No originating link and not superseded — can't prove staleness; keep.

  // A newer open escalation exists for the same originating item → this row is an
  // older re-attempt's residue.
  const newest = newestByItem.get(itemId);
  if (newest && newest.reportId !== row.reportId) return "superseded-by-newer-escalation";

  // Work shipped.
  if (row.backlogItemStatus === "done") return "originating-item-done";
  // Work won't be done (dropped, or folded into a canonical item).
  if (row.backlogItemTriageOutcome && WONT_DO_TRIAGE_OUTCOMES.has(row.backlogItemTriageOutcome)) {
    return "originating-item-wont-do";
  }

  // Still a live, pending decision (or deferred-and-still-wanted) → keep.
  return null;
}
