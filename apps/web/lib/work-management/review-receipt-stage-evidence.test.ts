import { describe, expect, it } from "vitest";

import type { ReceiptEnvelope } from "./receipt-envelope";
import { mergeReviewStageEvidence, reviewReceiptStageEvidence } from "./review-receipt-stage-evidence";
import { earnEvidenceReceipts } from "./stage-evidence-receipts";

// BI-80738C08: a passed readiness review is the review stage's evidence.

const STAGES = [
  { key: "spec-approval", evidence: ["spec-approval-receipt", "architecture-review-receipt", "objective-baseline"] },
  { key: "plan", evidence: ["plan-doc", "plan-coverage-receipt", "plan-review-receipt"] },
];

function receipt(gate: string, stageKey: string, evidenceKind: string, decision: string, at: string): ReceiptEnvelope {
  return {
    receiptId: `${gate}-${at}`, receiptKind: gate, enforcementMode: "observed-event",
    sourceRef: { kind: "work-capsule", id: "WC-1", status: decision }, status: "observed",
    summary: `${gate}: ${decision}`, occurredAt: at, outputDigest: { decision }, policyRefs: [],
    processEvidence: { definitionRef: "delivery-large@1.0.0", stageKey, evidenceKind, relationship: "required-evidence" },
  } as unknown as ReceiptEnvelope;
}

const STARTED = new Date("2026-10-07T10:00:00Z");

describe("reviewReceiptStageEvidence", () => {
  it("completes the plan stage on its passing plan review, stamped when the review landed", () => {
    const rows = reviewReceiptStageEvidence({ stages: STAGES, receipts: [receipt("plan-review", "plan", "plan-review-receipt", "pass", "2026-10-07T11:00:00Z")] });
    expect(rows).toEqual([{ stageKey: "plan", kind: "plan-review-receipt", outcome: "completed", recordedAt: new Date("2026-10-07T11:00:00Z") }]);
    // The drive earns the stage's completing receipt from it.
    const earned = earnEvidenceReceipts({ stageKey: "plan", declaredKinds: STAGES[1]!.evidence, evidence: rows, dispatchedAt: STARTED, existing: [] });
    expect(earned).toEqual([{ stageKey: "plan", kind: "stage-evidence-recorded" }]);
  });

  it("waits while a review the stage declares is still owed", () => {
    // spec-approval passed, architecture review not yet recorded: the stage condition is not met.
    const rows = reviewReceiptStageEvidence({ stages: STAGES, receipts: [receipt("spec-approval", "spec-approval", "spec-approval-receipt", "pass", "2026-10-07T11:00:00Z")] });
    expect(rows).toEqual([]);
  });

  it("completes when every declared review has passed, at the moment the last one landed", () => {
    const rows = reviewReceiptStageEvidence({ stages: STAGES, receipts: [
      receipt("spec-approval", "spec-approval", "spec-approval-receipt", "pass", "2026-10-07T09:00:00Z"),
      receipt("architecture-review", "spec-approval", "architecture-review-receipt", "pass", "2026-10-07T12:00:00Z"),
    ] });
    expect(rows.map((row) => [row.kind, row.outcome, row.recordedAt.toISOString()])).toEqual([
      ["spec-approval-receipt", "completed", "2026-10-07T12:00:00.000Z"],
      ["architecture-review-receipt", "completed", "2026-10-07T12:00:00.000Z"],
    ]);
    // A spec approval recorded before the stage started still counts once the last review lands after it.
    expect(earnEvidenceReceipts({ stageKey: "spec-approval", declaredKinds: STAGES[0]!.evidence, evidence: rows, dispatchedAt: STARTED, existing: [] }))
      .toEqual([{ stageKey: "spec-approval", kind: "stage-evidence-recorded" }]);
  });

  it("records a failing review as a blocker that never advances the stage", () => {
    const rows = reviewReceiptStageEvidence({ stages: STAGES, receipts: [receipt("plan-review", "plan", "plan-review-receipt", "fail", "2026-10-07T11:00:00Z")] });
    expect(rows).toEqual([{ stageKey: "plan", kind: "plan-review-receipt", outcome: "blocked", recordedAt: new Date("2026-10-07T11:00:00Z") }]);
    expect(earnEvidenceReceipts({ stageKey: "plan", declaredKinds: STAGES[1]!.evidence, evidence: rows, dispatchedAt: STARTED, existing: [] })).toEqual([]);
  });

  it("does not advance a different stage than the one the receipt is bound to", () => {
    const rows = reviewReceiptStageEvidence({ stages: STAGES, receipts: [receipt("plan-review", "plan", "plan-review-receipt", "pass", "2026-10-07T11:00:00Z")] });
    expect(earnEvidenceReceipts({ stageKey: "spec-approval", declaredKinds: STAGES[0]!.evidence, evidence: rows, dispatchedAt: STARTED, existing: [] })).toEqual([]);
  });

  it("ignores a receipt not bound to a stage (historical source) and a review older than the stage start", () => {
    const unbound = { ...receipt("plan-review", "plan", "plan-review-receipt", "pass", "2026-10-07T11:00:00Z"), processEvidence: undefined };
    expect(reviewReceiptStageEvidence({ stages: STAGES, receipts: [unbound] })).toEqual([]);
    const stale = reviewReceiptStageEvidence({ stages: STAGES, receipts: [receipt("plan-review", "plan", "plan-review-receipt", "pass", "2026-10-07T08:00:00Z")] });
    expect(earnEvidenceReceipts({ stageKey: "plan", declaredKinds: STAGES[1]!.evidence, evidence: stale, dispatchedAt: STARTED, existing: [] })).toEqual([]);
  });
});

describe("mergeReviewStageEvidence", () => {
  const review = [{ stageKey: "plan", kind: "plan-review-receipt", outcome: "completed", recordedAt: new Date("2026-10-07T11:00:00Z") }];
  const authorWrite = { stageKey: "plan", kind: "plan-review-receipt", outcome: "completed", recordedAt: new Date("2026-10-07T11:30:00Z") };

  it("adds the review rows beside the room's own evidence when the stage already has a start", () => {
    const merged = mergeReviewStageEvidence({ recordedEvidence: [authorWrite], stageDispatchedAt: STARTED }, { rows: review, start: null });
    expect(merged.recordedEvidence).toEqual([authorWrite, ...review]);
    expect(merged.stageDispatchedAt).toBe(STARTED);
  });

  it("starts a reviewer-role stage at the reviewer ask, and only the review counts for it", () => {
    const asked = new Date("2026-10-07T10:30:00Z");
    const merged = mergeReviewStageEvidence({ recordedEvidence: [authorWrite], stageDispatchedAt: null }, { rows: review, start: { stageKey: "plan", startedAt: asked } });
    expect(merged.stageDispatchedAt).toBe(asked);
    expect(merged.recordedEvidence).toEqual(review);
  });

  it("does not start a stage on an author's write alone", () => {
    const merged = mergeReviewStageEvidence({ recordedEvidence: [authorWrite], stageDispatchedAt: null }, { rows: [], start: { stageKey: "plan", startedAt: STARTED } });
    expect(merged.stageDispatchedAt).toBeNull();
    expect(earnEvidenceReceipts({ stageKey: "plan", declaredKinds: STAGES[1]!.evidence, evidence: merged.recordedEvidence!, dispatchedAt: merged.stageDispatchedAt ?? null, existing: [] })).toEqual([]);
  });
});
