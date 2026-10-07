import { describe, expect, it } from "vitest";

import {
  STEWARD_PROPOSAL_MAX_CONFIDENCE,
  isStewardEligible,
  proposeDemandScoreInputs,
  selectStewardBatch,
  stewardPriority,
  type ScoreProposalSignals,
} from "./score-proposal";

function signals(over: Partial<ScoreProposalSignals> = {}): ScoreProposalSignals {
  return {
    itemId: "BI-1",
    title: "A thing",
    body: null,
    status: "open",
    workType: "feature",
    source: "automated-detection",
    effortSize: "medium",
    occurrenceCount: 1,
    investmentBucket: null,
    epicStatus: null,
    activeEvidenceCount: 0,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    duplicateOfId: null,
    reach: null,
    impact: null,
    confidence: null,
    jobSize: null,
    demandScore: null,
    demandInputSource: null,
    estimateAiJobSize: null,
    estimateHumanJobSize: null,
    estimateAgreed: null,
    ...over,
  };
}

describe("isStewardEligible", () => {
  it("takes an unscored, triaged, non-duplicate item", () => {
    expect(isStewardEligible(signals())).toBe(true);
    expect(isStewardEligible(signals({ status: "in-progress" }))).toBe(true);
  });

  it("leaves untriaged and closed work alone", () => {
    for (const status of ["triaging", "done", "retired", "deferred", "awaiting-acceptance"]) {
      expect(isStewardEligible(signals({ status }))).toBe(false);
    }
    expect(isStewardEligible(signals({ duplicateOfId: "x" }))).toBe(false);
  });

  it("never proposes over an owner's inputs (AC-2)", () => {
    expect(isStewardEligible(signals({ demandInputSource: "human" }))).toBe(false);
    expect(isStewardEligible(signals({ demandInputSource: "agreed" }))).toBe(false);
  });

  it("skips anything already scored, by anyone", () => {
    expect(isStewardEligible(signals({ demandScore: 4 }))).toBe(false);
    expect(isStewardEligible(signals({ impact: 1, confidence: 0.8 }))).toBe(false);
  });
});

describe("proposeDemandScoreInputs", () => {
  it("proposes RICE inputs on Intercom's scales with a stated basis", () => {
    const p = proposeDemandScoreInputs(signals());
    expect(p).not.toBeNull();
    expect(p!.reach).toBe(1);
    expect([0.25, 0.5, 1, 2, 3]).toContain(p!.impact);
    expect([0.5, 0.8]).toContain(p!.confidence);
    expect(p!.jobSize).toBe(3);
    expect(p!.jobSizeFrom).toBe("effortSize");
    expect(p!.basis.length).toBeGreaterThan(0);
    expect(p!.basis.join(" ")).toMatch(/medium/);
  });

  it("is deterministic: the same signals always give the same proposal", () => {
    const s = signals({ workType: "bug", source: "user-request", occurrenceCount: 4 });
    expect(proposeDemandScoreInputs(s)).toEqual(proposeDemandScoreInputs(s));
  });

  it("raises impact for user requests, severe bugs and in-flight epics, capped at massive", () => {
    const base = proposeDemandScoreInputs(signals({ workType: "bug" }))!.impact;
    const asked = proposeDemandScoreInputs(signals({ workType: "bug", source: "user-request" }))!.impact;
    expect(asked).toBeGreaterThan(base);
    const all = proposeDemandScoreInputs(
      signals({
        workType: "bug",
        source: "user-request",
        epicStatus: "in-progress",
        title: "Data loss on save",
      }),
    )!.impact;
    expect(all).toBe(3);
  });

  it("caps confidence below an owner's certainty; evidence lifts it to medium", () => {
    expect(proposeDemandScoreInputs(signals())!.confidence).toBe(0.5);
    expect(proposeDemandScoreInputs(signals({ activeEvidenceCount: 2 }))!.confidence).toBe(0.8);
    expect(STEWARD_PROPOSAL_MAX_CONFIDENCE).toBeLessThan(1);
  });

  it("reach counts recurrence plus reviewed evidence", () => {
    expect(proposeDemandScoreInputs(signals({ occurrenceCount: 3, activeEvidenceCount: 2 }))!.reach).toBe(5);
  });

  it("keeps every input already present and only fills the gaps", () => {
    const p = proposeDemandScoreInputs(signals({ reach: 40, jobSize: 5 }))!;
    expect(p.reach).toBe(40);
    expect(p.jobSize).toBe(5);
    expect(p.jobSizeFrom).toBe("existing");
  });

  it("uses the human effort estimate when one exists", () => {
    const p = proposeDemandScoreInputs(signals({ estimateHumanJobSize: 8, estimateAiJobSize: 3 }))!;
    expect(p.jobSize).toBe(8);
    expect(p.jobSizeFrom).toBe("estimate");
  });

  it("does not invent an effort size: no size signal means no proposal", () => {
    expect(proposeDemandScoreInputs(signals({ effortSize: null }))).toBeNull();
  });

  it("derives the bucket from work type, keeps an existing one, and leaves unmappable work for the owner", () => {
    expect(proposeDemandScoreInputs(signals({ workType: "bug" }))!.investmentBucket).toBe("run");
    expect(proposeDemandScoreInputs(signals({ workType: "feature" }))!.investmentBucket).toBe("grow");
    expect(proposeDemandScoreInputs(signals({ investmentBucket: "transform" }))!.investmentBucket).toBe("transform");
    const doc = proposeDemandScoreInputs(signals({ workType: "doc" }))!;
    expect(doc.investmentBucket).toBeNull();
    expect(doc.basis.join(" ")).toMatch(/bucket/i);
  });
});

describe("selectStewardBatch", () => {
  it("orders highest likely value first and bounds the batch", () => {
    const rows = [
      signals({ itemId: "BI-PLAIN" }),
      signals({ itemId: "BI-EPIC", epicStatus: "in-progress" }),
      signals({ itemId: "BI-ASKED", source: "user-request" }),
      signals({ itemId: "BI-LIVEBUG", workType: "bug", activeEvidenceCount: 1 }),
      signals({ itemId: "BI-SCORED", demandScore: 2 }),
      signals({ itemId: "BI-OWNED", demandInputSource: "human" }),
    ];
    const batch = selectStewardBatch(rows, 3);
    expect(batch.map((r) => r.itemId)).toEqual(["BI-EPIC", "BI-LIVEBUG", "BI-ASKED"]);
  });

  it("breaks ties oldest first, then by id, so runs are reproducible", () => {
    const rows = [
      signals({ itemId: "BI-B", createdAt: new Date("2026-09-02T00:00:00Z") }),
      signals({ itemId: "BI-C", createdAt: new Date("2026-09-01T00:00:00Z") }),
      signals({ itemId: "BI-A", createdAt: new Date("2026-09-01T00:00:00Z") }),
    ];
    expect(selectStewardBatch(rows, 10).map((r) => r.itemId)).toEqual(["BI-A", "BI-C", "BI-B"]);
  });

  it("gives an in-flight epic more weight than an open one", () => {
    expect(stewardPriority(signals({ epicStatus: "in-progress" }))).toBeGreaterThan(
      stewardPriority(signals({ epicStatus: "open" })),
    );
  });
});
