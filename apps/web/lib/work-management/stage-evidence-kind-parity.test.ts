// Structural guard: every evidence kind a work-shape stage declares must be a
// kind the evidence tool accepts.
//
// This exists because the two vocabularies drifted apart and nothing noticed.
// The shapes declared `assurance-run`, `decision-record`, `pr-gate` and ~45
// more; `record_workroom_evidence` accepted only test|build|screenshot|
// verification|lint|note. A stage advances only on recorded evidence of a kind
// it declared (stageHasCompletingEvidence), so no stage on the install could
// ever earn a completing receipt. Coworkers did the work, recorded it under the
// only kinds the tool allowed, and every room sat on its first stage.
//
// Kernel decision DI-BE0348CE9229: widen the accepted vocabulary to the shapes'
// declared kinds rather than collapse the shapes onto six media kinds.

import { describe, expect, it } from "vitest";

import { isWorkCapsuleEvidenceKind, WORK_CAPSULE_EVIDENCE_KINDS } from "../work-capsules";
import { earnEvidenceReceipts, STAGE_EVIDENCE_RECEIPT_KIND } from "./stage-evidence-receipts";
import { WORK_SHAPE_EVIDENCE_KINDS } from "./work-shape-evidence-kinds";
import { listWorkShapes } from "./work-shapes";

const declared = listWorkShapes().flatMap((shape) =>
  shape.stages.flatMap((stage) =>
    stage.evidence.map((kind) => ({ shape: shape.key, stage: stage.key, kind: kind as string })),
  ),
);

describe("work-shape evidence kinds are accepted by the evidence tool", () => {
  it("the registry declares evidence at all (the guard is not vacuous)", () => {
    expect(declared.length).toBeGreaterThan(100);
  });

  it("every stage-declared kind is a kind record_workroom_evidence accepts", () => {
    const rejected = declared.filter((entry) => !isWorkCapsuleEvidenceKind(entry.kind));
    expect(rejected).toEqual([]);
  });

  it("the shape vocabulary carries no kind no shape declares", () => {
    const used = new Set(declared.map((entry) => entry.kind));
    expect(WORK_SHAPE_EVIDENCE_KINDS.filter((kind) => !used.has(kind))).toEqual([]);
  });

  it("the accepted vocabulary has no duplicates", () => {
    expect(new Set(WORK_CAPSULE_EVIDENCE_KINDS).size).toBe(WORK_CAPSULE_EVIDENCE_KINDS.length);
  });

  it("evidence of a stage's declared kind earns that stage its completing receipt", () => {
    const dispatchedAt = new Date("2026-09-23T00:00:00Z");
    const recordedAt = new Date("2026-09-23T00:05:00Z");
    for (const shape of listWorkShapes()) {
      for (const stage of shape.stages) {
        if (stage.evidence.length === 0) continue;
        const receipts = earnEvidenceReceipts({
          stageKey: stage.key,
          declaredKinds: stage.evidence,
          evidence: [{ stageKey: stage.key, kind: stage.evidence[0]!, outcome: "completed", recordedAt }],
          dispatchedAt,
          existing: [],
        });
        expect(receipts, `${shape.key}/${stage.key}`).toEqual([
          { stageKey: stage.key, kind: STAGE_EVIDENCE_RECEIPT_KIND },
        ]);
      }
    }
  });

  it("a generic kind the stage did not declare still earns nothing", () => {
    const stage = declared.find((entry) => entry.kind === "assurance-run");
    expect(stage).toBeDefined();
    const receipts = earnEvidenceReceipts({
      stageKey: stage!.stage,
      declaredKinds: ["assurance-run"],
      evidence: [{ stageKey: stage!.stage, kind: "note", outcome: "completed", recordedAt: new Date("2026-09-23T00:05:00Z") }],
      dispatchedAt: new Date("2026-09-23T00:00:00Z"),
      existing: [],
    });
    expect(receipts).toEqual([]);
  });
});
