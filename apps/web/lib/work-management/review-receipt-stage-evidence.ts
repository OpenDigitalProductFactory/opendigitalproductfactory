// BI-80738C08 (EP-4614F35E) — a passed readiness review is the review stage's
// evidence.
//
// A room's review stage (BI-2C8750FC) declares the initiative receipt kinds it
// leaves behind: spec-approval-receipt, architecture-review-receipt,
// plan-review-receipt. The independent reviewer records those receipts with
// record_initiative_design_review on the BACKLOG ITEM, while the drive earns a
// stage's completing receipt only from stage-scoped evidence on the ROOM. Nothing
// connected the two, so a stage whose review had passed kept waiting
// (executor_writeback_unavailable) until someone copied the outcome by hand.
//
// This module is the pure half of the bridge. It reads the receipts the room's
// initiative-evidence readout already binds to a stage (workroom-initiative-
// evidence.ts: same repository, the room's current head, exactly one stage
// declaring the kind) and turns them into the stage evidence the drive reads.
//
// The stage completes on the reviews it declares, not on any one of them:
// - every initiative receipt kind the stage declares has a passing (or
//   not-applicable) receipt → a `completed` row per receipt, stamped at the
//   moment the last of them landed, so evidence older than the stage's start
//   still cannot satisfy it;
// - any declared receipt is failing → a `blocked` row (never advances; the
//   room's readout shows the failing receipt and its reason);
// - otherwise nothing: the stage waits for the reviews still owed.
// The receipt is the governed, server-resolved write of an independent reviewer;
// independence is enforced where it is recorded, not re-derived here.

import type { ReceiptEnvelope } from "./receipt-envelope";
import { INITIATIVE_GATE_STAGE_EVIDENCE_KIND } from "./readiness-review-stages";
import type { RecordedEvidence } from "./stage-evidence-receipts";

const INITIATIVE_RECEIPT_KINDS: ReadonlySet<string> = new Set(Object.values(INITIATIVE_GATE_STAGE_EVIDENCE_KIND));
const SATISFIED = new Set(["pass", "not-applicable"]);

type StageDeclaration = { key: string; evidence: readonly string[] };

function decisionOf(receipt: ReceiptEnvelope): string | null {
  const digest = receipt.outputDigest as { decision?: unknown } | null | undefined;
  return typeof digest?.decision === "string" ? digest.decision : null;
}

/** The stage evidence one room's bound initiative receipts amount to. */
export function reviewReceiptStageEvidence(input: {
  receipts: readonly ReceiptEnvelope[];
  stages: readonly StageDeclaration[];
}): RecordedEvidence[] {
  const byStage = new Map<string, ReceiptEnvelope[]>();
  for (const receipt of input.receipts) {
    const bound = receipt.processEvidence;
    if (!bound || !INITIATIVE_RECEIPT_KINDS.has(bound.evidenceKind)) continue;
    byStage.set(bound.stageKey, [...(byStage.get(bound.stageKey) ?? []), receipt]);
  }
  const rows: RecordedEvidence[] = [];
  for (const [stageKey, receipts] of byStage) {
    const stage = input.stages.find((entry) => entry.key === stageKey);
    if (!stage) continue;
    const declared = stage.evidence.filter((kind) => INITIATIVE_RECEIPT_KINDS.has(kind));
    const failing = receipts.filter((receipt) => !SATISFIED.has(decisionOf(receipt) ?? ""));
    if (failing.length > 0) {
      for (const receipt of failing) {
        rows.push({ stageKey, kind: receipt.processEvidence!.evidenceKind, outcome: "blocked", recordedAt: new Date(receipt.occurredAt) });
      }
      continue;
    }
    const passedKinds = new Set(receipts.map((receipt) => receipt.processEvidence!.evidenceKind));
    if (declared.length === 0 || !declared.every((kind) => passedKinds.has(kind))) continue;
    const completedAt = new Date(Math.max(...receipts.map((receipt) => new Date(receipt.occurredAt).getTime())));
    if (!Number.isFinite(completedAt.getTime())) continue;
    for (const receipt of receipts) {
      rows.push({ stageKey, kind: receipt.processEvidence!.evidenceKind, outcome: "completed", recordedAt: completedAt });
    }
  }
  return rows;
}

export type ReviewEvidenceRoom = {
  recordedEvidence?: RecordedEvidence[];
  stageDispatchedAt?: Date | null;
};

/**
 * Merge a room's review evidence into what the drive reads.
 *
 * A review stage bound to a reviewer ROLE is asked, never dispatched, and the
 * drive starts only a role:author ask (BI-C9912C22) so an author's own evidence
 * cannot satisfy a reviewer's stage. Here the reviewer's ask (`reviewStart`)
 * starts the stage instead, and for that stage only the review receipts count:
 * the room's own writes for it are dropped, so the author still cannot satisfy it.
 */
export function mergeReviewStageEvidence<R extends ReviewEvidenceRoom>(
  room: R,
  review: { rows: readonly RecordedEvidence[]; start: { stageKey: string; startedAt: Date } | null },
): R {
  if (review.rows.length === 0) return room;
  const existing = room.recordedEvidence ?? [];
  const start = review.start;
  if (!room.stageDispatchedAt && start && review.rows.some((row) => row.stageKey === start.stageKey)) {
    return {
      ...room,
      stageDispatchedAt: start.startedAt,
      recordedEvidence: [...existing.filter((row) => row.stageKey !== start.stageKey), ...review.rows],
    };
  }
  return { ...room, recordedEvidence: [...existing, ...review.rows] };
}
