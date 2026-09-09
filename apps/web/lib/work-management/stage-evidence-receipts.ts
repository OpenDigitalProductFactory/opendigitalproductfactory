// A stage advances on recorded evidence, not on a claim of completion
// (BI-76B35820, after the refusal of PR #5168).
//
// #5168 proposed earning the completing receipt from `TaskRun.status ===
// "completed"`. That was correctly refused: a completed TaskRun is the
// executor's claim about ITSELF. On this install all 337 such claims were false
// — `executedToolCount: 0`, `scheduledSummary: null` — so earning receipts from
// them would have converted 337 fabrications into stage advancement and undone
// the fail-closed pause added by #5166. A visible loop is strictly better than
// silent false progress.
//
// The kernel already says this: governance approves evidence, not provenance;
// structural verification is not functional verification.
//
// So the receipt is earned from a governed WRITE the worker had to make through
// MCP — `record_workroom_evidence`, a sanctioned mutator requiring
// `work_capsule_write` — carrying the stage it belongs to and an evidence kind
// the stage declared. The drive still owns the advance; the worker cannot
// advance itself, it can only leave evidence the drive then reads.
//
// Pure resolution over supplied rows.

import { appendCompletingWorkroomDriveReceipt, isCompletingWorkroomDriveReceipt } from "./workroom-drive-receipts";

export type RecordedEvidence = {
  /** Stage the evidence was recorded against. Evidence with no stage cannot
   *  advance one — it is a note on the room, not a stage outcome. */
  stageKey: string | null;
  kind: string | null;
  recordedAt: Date;
};

export type StageEvidenceInput = {
  stageKey: string | null;
  /** Kinds the stage declared it would leave behind. Empty means the stage
   *  declared none, and any stage-scoped evidence counts. */
  declaredKinds: readonly string[];
  evidence: readonly RecordedEvidence[];
  /** When the stage was most recently dispatched. Evidence older than the
   *  dispatch belongs to a previous attempt and must not satisfy this one. */
  dispatchedAt: Date | null;
};

/**
 * Whether the current stage has evidence good enough to advance on.
 *
 * Deliberately strict, because the failure this replaces was permissive:
 *
 * - Evidence must name THIS stage. Room-level notes do not advance a stage.
 * - It must be of a kind the stage declared, when the stage declared any.
 * - It must post-date the dispatch, so a previous attempt's evidence cannot
 *   satisfy a fresh one.
 *
 * Anything short of that returns false and the stage is dispatched again, which
 * is the correct, visible, non-fabricating outcome.
 */
export function stageHasCompletingEvidence(input: StageEvidenceInput): boolean {
  if (!input.stageKey || !input.dispatchedAt || !Number.isFinite(input.dispatchedAt.getTime())) return false;
  const declared = new Set(input.declaredKinds.filter((kind) => kind.trim().length > 0));
  return input.evidence.some((row) => {
    if (row.stageKey !== input.stageKey) return false;
    if (declared.size > 0 && (row.kind === null || !declared.has(row.kind))) return false;
    if (input.dispatchedAt && row.recordedAt < input.dispatchedAt) return false;
    return true;
  });
}

/** Receipt kind recorded when a stage's governed evidence is present. Distinct
 *  from #5166's `blocked`, which records a dispatch that produced no writeback. */
export const STAGE_EVIDENCE_RECEIPT_KIND = "stage-evidence-recorded";

export type StageReceipt = { stageKey: string; kind: string };

/**
 * The room's receipts after reading its recorded evidence.
 *
 * Idempotent, and returns the SAME array reference when nothing was earned so a
 * caller can cheaply skip the write.
 */
export function earnEvidenceReceipts(input: StageEvidenceInput & {
  existing: readonly StageReceipt[];
}): readonly StageReceipt[] {
  if (!input.stageKey) return input.existing;
  if (input.existing.some((receipt) => isCompletingWorkroomDriveReceipt(receipt, input.stageKey!))) return input.existing;
  if (!stageHasCompletingEvidence(input)) return input.existing;
  const result = appendCompletingWorkroomDriveReceipt(input.existing, { stageKey: input.stageKey, kind: STAGE_EVIDENCE_RECEIPT_KIND });
  return result.ok ? result.data : input.existing;
}
