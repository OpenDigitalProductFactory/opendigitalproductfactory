// Auto-withdraw stale build-linked decision residue (BI-FE034C1E, EP-ATTENTION-SURFACE).
//
// A Build Studio gate writes a DecisionInteraction with outcomeType
// escalate/defer and humanOutcome null. Abandoning (or finishing) the build
// never touches that row, so it stays unresolved forever and
// sources/ai-decision.ts keeps projecting it into "Needs you" — where
// owner-routing hard-routes high-risk-gate residue to needs-you-now. The card
// then tells the owner "build FB-XXXXXXXX stays blocked" about a build that
// died hours ago: a false consequence AND an inflated count.
//
// This is the same CREATE-path-without-CLEAR-path gap escalation-staleness.ts
// closed for PlatformIssueReport rows (BI-467E8F8D), recurring on a different
// table. The cure is deliberately the same shape, so the two sweeps read alike.
//
// PURE: given joined rows (the interaction + its build's phase/supersede marker
// + the originating BacklogItem's status/triageOutcome), decide which to
// withdraw and why. The DB read/write lives in escalation-hygiene-runner.ts so
// this stays trivially unit-testable.
//
// NOT a human ruling. A withdrawal records that the QUESTION evaporated, not
// that anyone answered it — see buildWithdrawnHumanOutcome. It must never clear
// a gate, become candidate decision material, or count as a resolution on the
// audit surface (decision-audit.ts reads `resolvedBy` to tell the two apart).

/**
 * Originating-item triage outcomes that mean the work will NOT be done. Mirrors
 * escalation-staleness.ts: a `deferred` status spans both "parked, still wanted"
 * and "discarded", so staleness keys off triageOutcome, not status alone.
 */
const WONT_DO_TRIAGE_OUTCOMES = new Set(["discard", "duplicate"]);

/**
 * Build phases that end the build's life. `abandoned` is the case that produced
 * this BI; `complete`/`failed` are included because a plan-readiness gate whose
 * build already shipped or died is equally moot — a re-attempt writes a NEW
 * interaction rather than reviving this one. Phases still in flight
 * (ideate/plan/build/review/ship) and `panicked` (a live, recoverable stall) are
 * deliberately absent: those rows stay in the queue.
 */
const FINISHED_BUILD_PHASES = new Set(["complete", "failed"]);

export interface DecisionResidueRow {
  /** DecisionInteraction.interactionId (semantic DI-* id). */
  interactionId: string;
  /** escalate | defer — the unresolved residue outcomes. */
  outcomeType: string;
  /** FeatureBuild.buildId this decision gated, or null when not build-linked. */
  buildId: string | null;
  /** FeatureBuild.phase, or null when unlinked / build row missing. */
  buildPhase: string | null;
  /** FeatureBuild.supersededByEpicId — set when a decompose was approved. */
  buildSupersededByEpicId: string | null;
  /** Originating BacklogItem.status, or null if unlinked/missing. */
  backlogItemStatus: string | null;
  /** Originating BacklogItem.triageOutcome, or null. */
  backlogItemTriageOutcome: string | null;
}

export type DecisionWithdrawalReason =
  | "build-superseded-by-epic"
  | "originating-build-abandoned"
  | "originating-build-finished"
  | "originating-item-done"
  | "originating-item-wont-do";

export interface WithdrawableDecision {
  interactionId: string;
  /** Stable machine reason for the withdrawal, surfaced in logs and on the row. */
  reason: DecisionWithdrawalReason;
}

/**
 * Select the decision residue that is safe to auto-withdraw, with a reason each.
 *
 * Conservative by construction. A row is withdrawn only when it is BUILD-LINKED
 * and that build's life is provably over: an interaction with no `buildId` has
 * no staleness signal to read (the org-business and profession gates write those
 * — they are answered by a human at /coworker-decisions/review, never swept),
 * and a build still in flight leaves its gate open.
 */
export function selectWithdrawableDecisions(
  rows: DecisionResidueRow[],
): WithdrawableDecision[] {
  const out: WithdrawableDecision[] = [];
  for (const row of rows) {
    const reason = withdrawalReason(row);
    if (reason) out.push({ interactionId: row.interactionId, reason });
  }
  return out;
}

function withdrawalReason(row: DecisionResidueRow): DecisionWithdrawalReason | null {
  // Not build-linked → nothing here proves the question evaporated. Keep.
  if (!row.buildId) return null;

  // The decompose was approved → the build this gate guarded was superseded.
  if (row.buildSupersededByEpicId) return "build-superseded-by-epic";

  // The case that produced this BI: a terminal abandoned build.
  if (row.buildPhase === "abandoned") return "originating-build-abandoned";

  // Shipped or dead — either way the gate no longer guards anything.
  if (row.buildPhase && FINISHED_BUILD_PHASES.has(row.buildPhase)) {
    return "originating-build-finished";
  }

  // The build is still in flight, but the work it serves is settled.
  if (row.backlogItemStatus === "done") return "originating-item-done";
  if (
    row.backlogItemTriageOutcome
    && WONT_DO_TRIAGE_OUTCOMES.has(row.backlogItemTriageOutcome)
  ) {
    return "originating-item-wont-do";
  }

  // A live build with live work → a genuine open gate. Keep.
  return null;
}

/** Marks a `humanOutcome` written by this sweep rather than by a person. */
export const SYSTEM_WITHDRAWAL_RESOLVER = "system:decision-residue-hygiene";

/**
 * The withdrawal payload's shape. Kept to JSON primitives (rather than a
 * `Record<string, unknown>`) so it is directly assignable to Prisma's
 * `InputJsonValue` at the `humanOutcome` write.
 */
export type WithdrawnHumanOutcome = {
  type: "withdrawn";
  reason: DecisionWithdrawalReason;
  resolvedBy: string;
  resolverUserId: null;
  clearsGate: false;
  candidateMaterial: false;
  capturedAt: string;
};

/**
 * The `humanOutcome` payload for a withdrawal.
 *
 * Deliberately NOT shaped like a capture (org-decision-capture.ts /
 * DecisionPerspectiveGatePanel). It carries no answer and no rationale, because
 * nobody answered anything:
 *
 * - `clearsGate: false` + no EscalationCapture row → `interactionWasCleared`
 *   (decision-perspective/persistence.ts) stays false, so a withdrawal can never
 *   masquerade as a passed gate.
 * - `candidateMaterial: false` → never promoted into the decision corpus.
 * - `chosenOptionId` is left untouched, so the weight-inference adapter
 *   (weight-inference-adapter.ts, which selects on chosenOptionId NOT NULL)
 *   never reads a withdrawal as a human's option pick.
 * - `resolvedBy` names the sweep, which is how decision-audit.ts tells a
 *   withdrawal apart from a human resolution.
 */
export function buildWithdrawnHumanOutcome(input: {
  reason: DecisionWithdrawalReason;
  withdrawnAtIso: string;
}): WithdrawnHumanOutcome {
  return {
    type: "withdrawn",
    reason: input.reason,
    resolvedBy: SYSTEM_WITHDRAWAL_RESOLVER,
    resolverUserId: null,
    clearsGate: false,
    candidateMaterial: false,
    capturedAt: input.withdrawnAtIso,
  };
}

/**
 * True when a `humanOutcome` value is a machine withdrawal rather than a human's
 * answer. Read by any surface that reports "a human resolved this".
 */
export function isWithdrawnHumanOutcome(humanOutcome: unknown): boolean {
  if (!humanOutcome || typeof humanOutcome !== "object" || Array.isArray(humanOutcome)) {
    return false;
  }
  const record = humanOutcome as Record<string, unknown>;
  return record.type === "withdrawn" && record.resolvedBy === SYSTEM_WITHDRAWAL_RESOLVER;
}
