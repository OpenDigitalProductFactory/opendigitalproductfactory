// A stage advances on recorded evidence, never on a claim (BI-76B35820).
//
// PR #5168 proposed earning receipts from TaskRun.status === "completed".
// Refused, and the live data is why: 337 such claims, every one with
// executedToolCount 0 and a null summary. Earning receipts from them would have
// converted 337 fabrications into stage advancement.

import { describe, expect, it } from "vitest";

import {
  STAGE_EVIDENCE_RECEIPT_KIND,
  earnEvidenceReceipts,
  stageHasCompletingEvidence,
  type RecordedEvidence,
} from "./stage-evidence-receipts";

const at = (iso: string) => new Date(iso);
const dispatchedAt = at("2026-09-07T10:00:00Z");
const evidence = (over: Partial<RecordedEvidence> = {}): RecordedEvidence => ({
  stageKey: "sweep",
  kind: "assurance-run",
  recordedAt: at("2026-09-07T10:05:00Z"),
  ...over,
});

const base = { stageKey: "sweep", declaredKinds: ["assurance-run"], dispatchedAt };

describe("stageHasCompletingEvidence", () => {
  it("rejects evidence without a recorded dispatch", () => {
    expect(stageHasCompletingEvidence({ ...base, dispatchedAt: null, evidence: [evidence()] })).toBe(false);
  });
  it("accepts governed evidence for this stage, of the declared kind, after dispatch", () => {
    expect(stageHasCompletingEvidence({ ...base, evidence: [evidence()] })).toBe(true);
  });

  it("rejects evidence recorded against a different stage", () => {
    expect(stageHasCompletingEvidence({ ...base, evidence: [evidence({ stageKey: "raise" })] })).toBe(false);
  });

  it("rejects room-level evidence that names no stage", () => {
    // A note on the room is not a stage outcome. Accepting it would let any
    // unrelated write advance the shape.
    expect(stageHasCompletingEvidence({ ...base, evidence: [evidence({ stageKey: null })] })).toBe(false);
  });

  it("rejects an evidence kind the stage never declared", () => {
    expect(stageHasCompletingEvidence({ ...base, evidence: [evidence({ kind: "note" })] })).toBe(false);
  });

  it("rejects evidence older than the dispatch — a previous attempt cannot satisfy this one", () => {
    expect(
      stageHasCompletingEvidence({
        ...base,
        evidence: [evidence({ recordedAt: at("2026-09-07T09:00:00Z") })],
      }),
    ).toBe(false);
  });

  it("accepts any stage-scoped evidence when the stage declared no kinds", () => {
    expect(
      stageHasCompletingEvidence({
        stageKey: "sweep",
        declaredKinds: [],
        dispatchedAt,
        evidence: [evidence({ kind: "note" })],
      }),
    ).toBe(true);
  });

  it("finds nothing when no evidence was recorded at all — today's live state", () => {
    // 337 completed runs, zero evidence rows from the standing rooms.
    expect(stageHasCompletingEvidence({ ...base, evidence: [] })).toBe(false);
  });

  it("earns nothing without a current stage", () => {
    expect(stageHasCompletingEvidence({ ...base, stageKey: null, evidence: [evidence()] })).toBe(false);
  });
});

describe("earnEvidenceReceipts", () => {
  it("replaces a blocked receipt when fresh matching evidence arrives", () => {
    expect(earnEvidenceReceipts({ ...base, evidence: [evidence()], existing: [{ stageKey: "sweep", kind: "blocked" }] })).toEqual([
      { stageKey: "sweep", kind: STAGE_EVIDENCE_RECEIPT_KIND },
    ]);
  });
  it("records the receipt that lets the drive advance", () => {
    expect(earnEvidenceReceipts({ ...base, evidence: [evidence()], existing: [] })).toEqual([
      { stageKey: "sweep", kind: STAGE_EVIDENCE_RECEIPT_KIND },
    ]);
  });

  it("is idempotent", () => {
    const existing = [{ stageKey: "sweep", kind: STAGE_EVIDENCE_RECEIPT_KIND }];
    expect(earnEvidenceReceipts({ ...base, evidence: [evidence(), evidence()], existing })).toBe(existing);
  });

  it("returns the same reference when nothing was earned, so no write is needed", () => {
    const existing: Array<{ stageKey: string; kind: string }> = [];
    expect(earnEvidenceReceipts({ ...base, evidence: [], existing })).toBe(existing);
  });

  it("never earns from a completion claim — there is no path from run status to a receipt", () => {
    // The refused design, asserted as absent: this module's only input is
    // recorded evidence. A "completed" run with no evidence earns nothing.
    const existing: Array<{ stageKey: string; kind: string }> = [];
    expect(earnEvidenceReceipts({ ...base, evidence: [], existing })).toBe(existing);
  });
});
